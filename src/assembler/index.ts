import { ISA, SFR, BITS, hex, type Instruction } from "../core/isa";
export type Diagnostic = { line: number; message: string };
export type Listing = {
  address: number;
  bytes: number[];
  line: number;
  source: string;
  instruction: string;
};
export type Assembly = {
  code: Uint8Array;
  used: Uint8Array;
  entry: number;
  listing: Listing[];
  symbols: Record<string, number>;
  errors: Diagnostic[];
  source: string;
};
export function splitArgs(s: string) {
  const out: string[] = [];
  let part = "",
    quote = "";
  for (const c of s) {
    if (quote) {
      part += c;
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
      part += c;
    } else if (c === ",") {
      out.push(part.trim());
      part = "";
    } else part += c;
  }
  if (part.trim()) out.push(part.trim());
  return out;
}
export function expression(
  input: string,
  symbols: Record<string, number>,
  pc = 0,
): number {
  const tokens =
    input.match(
      /'(?:[^']*)'|"(?:[^"]*)"|0x[0-9a-f]+|[0-9][0-9a-f]*[hHbBdD]?|[a-z_?$][\w?$]*|<<|>>|[()+\-*/%&|^~.]/gi,
    ) ?? [];
  const compact = input.replace(/'[^']*'|"[^"]*"|\s+/g, (s) =>
    s.startsWith("'") || s.startsWith('"') ? s : "",
  );
  if (tokens.join("").toUpperCase() !== compact.toUpperCase())
    throw new Error(`Invalid expression: ${input}`);
  let p = 0;
  const prec: Record<string, number> = {
    "|": 1,
    OR: 1,
    "^": 2,
    XOR: 2,
    "&": 3,
    AND: 3,
    "<<": 4,
    ">>": 4,
    SHL: 4,
    SHR: 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6,
    MOD: 6,
    ".": 7,
  };
  function atom(): number {
    const raw = tokens[p++];
    if (raw === undefined) throw new Error(`Missing expression in ${input}`);
    const t = raw.toUpperCase();
    if (t === "(") {
      const n = parse(0);
      if (tokens[p++] !== ")") throw new Error("Missing closing parenthesis");
      return n;
    }
    if (["+", "-", "~", "NOT", "HIGH", "LOW"].includes(t)) {
      const n = atom();
      return t === "-"
        ? -n
        : t === "~" || t === "NOT"
          ? ~n
          : t === "HIGH"
            ? (n >> 8) & 255
            : t === "LOW"
              ? n & 255
              : n;
    }
    if (t === "$") return pc;
    if (/^['"]/.test(t)) {
      if (raw.length !== 3)
        throw new Error("Character constant must contain one character");
      return raw.charCodeAt(1);
    }
    if (/^0X[\dA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
    if (/^\d[\dA-F]*H$/.test(t)) return parseInt(t.slice(0, -1), 16);
    if (/^[01]+B$/.test(t)) return parseInt(t.slice(0, -1), 2);
    if (/^\d+D?$/.test(t)) return parseInt(t, 10);
    if (t in symbols) return symbols[t];
    throw new Error(`Undefined symbol: ${raw}`);
  }
  function parse(min: number): number {
    let a = atom();
    while (p < tokens.length) {
      const op = tokens[p].toUpperCase(),
        pr = prec[op];
      if (pr === undefined || pr < min) break;
      p++;
      const b = parse(pr + 1);
      switch (op) {
        case "+":
          a += b;
          break;
        case "-":
          a -= b;
          break;
        case "*":
          a *= b;
          break;
        case "/":
          if (!b) throw new Error("Division by zero");
          a = Math.trunc(a / b);
          break;
        case "%":
        case "MOD":
          if (!b) throw new Error("Division by zero");
          a %= b;
          break;
        case "&":
        case "AND":
          a &= b;
          break;
        case "|":
        case "OR":
          a |= b;
          break;
        case "^":
        case "XOR":
          a ^= b;
          break;
        case "<<":
        case "SHL":
          a <<= b;
          break;
        case ">>":
        case "SHR":
          a >>>= b;
          break;
        case ".":
          if (
            b < 0 ||
            b > 7 ||
            (a >= 128 && a & 7) ||
            (a < 128 && (a < 32 || a > 47))
          )
            throw new Error("Address is not bit-addressable");
          a = a < 128 ? (a - 32) * 8 + b : a + b;
      }
    }
    return a;
  }
  const result = parse(0);
  if (p !== tokens.length || !Number.isFinite(result))
    throw new Error(`Invalid expression: ${input}`);
  return result;
}
const literals = new Set([
  "A",
  "C",
  "AB",
  "DPTR",
  "@DPTR",
  "@A+DPTR",
  "@A+PC",
  ...Array.from({ length: 8 }, (_, i) => `R${i}`),
  "@R0",
  "@R1",
]);
export function matchInstruction(name: string, args: string[]): Instruction {
  const options = ISA.filter((i): i is Instruction => !!i && i.name === name);
  const found = options.find(
    (i) =>
      i.args.length === args.length &&
      i.args.every((kind, n) => {
        const a = args[n].toUpperCase().replace(/\s/g, "");
        if (literals.has(kind)) return a === kind;
        if (kind === "I" || kind === "#W") return a.startsWith("#");
        if (kind === "/B") return a.startsWith("/");
        return (
          !!a &&
          !literals.has(a) &&
          !a.startsWith("#") &&
          !a.startsWith("@") &&
          !a.startsWith("/")
        );
      }),
  );
  if (!found)
    throw new Error(
      options.length
        ? `Invalid operands for ${name}: ${args.join(", ")}`
        : `Unknown instruction: ${name}`,
    );
  return found;
}
type Parsed = {
  line: number;
  source: string;
  label?: string;
  name: string;
  args: string[];
};
function parseLine(source: string, line: number): Parsed {
  let text = "",
    quote = "";
  for (const c of source) {
    if ((c === '"' || c === "'") && (!quote || quote === c))
      quote = quote ? "" : c;
    if (c === ";" && !quote) break;
    text += c;
  }
  text = text.trim();
  let label: string | undefined;
  const m = text.match(/^([\w?$]+)\s*:/);
  if (m) {
    label = m[1].toUpperCase();
    text = text.slice(m[0].length).trim();
    if (ISA.some((i) => i?.name === label) && /^[A-Z@#]/i.test(text))
      throw new Error(
        `Unexpected colon after ${label}. Use ${label} ${text} (for example ORL A,#0F0H).`,
      );
  }
  const declaration = text.match(
    /^([\w?$]+)\s+(EQU|DATA|IDATA|XDATA|CODE|BIT)\s+(.+)$/i,
  );
  if (declaration)
    return {
      line,
      source,
      label: declaration[1].toUpperCase(),
      name: "EQU",
      args: [declaration[3]],
    };
  const parts = text.match(/^(\S+)\s*(.*)$/);
  return {
    line,
    source,
    label,
    name: parts?.[1].toUpperCase() ?? "",
    args: splitArgs(parts?.[2] ?? ""),
  };
}
export function assemble(source: string): Assembly {
  const result: Assembly = {
    code: new Uint8Array(65536),
    used: new Uint8Array(65536),
    entry: 0,
    listing: [],
    symbols: { ...SFR, ...BITS },
    errors: [],
    source,
  };
  const rows: Parsed[] = [];
  const declarations = new Set<string>();
  source.split(/\r?\n/).forEach((s, i) => {
    try {
      const row = parseLine(s, i + 1);
      if (row.label) {
        if (declarations.has(row.label) || row.label in result.symbols)
          throw new Error(`Duplicate/reserved symbol: ${row.label}`);
        declarations.add(row.label);
      }
      rows.push(row);
    } catch (e) {
      result.errors.push({ line: i + 1, message: (e as Error).message });
    }
  });
  let settled = false;
  function pass(final: boolean) {
    let pc = 0,
      first = true;
    const before = JSON.stringify(result.symbols);
    for (const row of rows) {
      try {
        let { name, args } = row;
        if (name === "END") break;
        if (row.label && name !== "EQU") result.symbols[row.label] = pc;
        const val = (a: string) => expression(a, result.symbols, pc);
        if (name === "EQU") {
          if (!row.label || args.length !== 1)
            throw new Error("EQU requires a symbol and expression");
          result.symbols[row.label] = val(args[0]);
          continue;
        }
        if (!name || ["$MOD51", "$NOMOD51", "NAME", "PUBLIC"].includes(name))
          continue;
        if (name === "CSEG") {
          if (args.length) {
            const a = args.join(" ").replace(/^AT\s+/i, "");
            pc = val(a);
          }
          continue;
        }
        if (name === "ORG") {
          if (args.length !== 1) throw new Error("ORG requires one address");
          pc = val(args[0]);
          if (pc < 0 || pc > 65535)
            throw new Error("ORG outside CODE address space");
          continue;
        }
        if (name === "DS") {
          const n = val(args[0]);
          if (n < 0 || pc + n > 65536)
            throw new Error("DS outside CODE address space");
          pc += n;
          continue;
        }
        let bytes: number[] = [],
          actual = name;
        if (name === "DB" || name === "DW") {
          for (const arg of args) {
            if (name === "DB" && /^(['"]).*\1$/.test(arg)) {
              for (const c of arg.slice(1, -1)) bytes.push(c.charCodeAt(0));
            } else {
              const n = final ? val(arg) : 0;
              if (n < 0 || n > (name === "DW" ? 65535 : 255))
                throw new Error(`${name} value out of range`);
              if (name === "DW") bytes.push(n >> 8);
              bytes.push(n & 255);
            }
          }
        } else {
          if (
            name === "JMP" &&
            args[0]?.toUpperCase().replace(/\s/g, "") !== "@A+DPTR"
          ) {
            name = "LJMP";
            actual = "LJMP";
          }
          const ins = matchInstruction(name, args);
          bytes = [ins.op];
          for (const i of ins.order) {
            const kind = ins.args[i];
            let n = final ? val(args[i].replace(/^[#/]/, "")) : 0;
            if (final) {
              const max = ["W", "#W", "Q", "T"].includes(kind) ? 65535 : 255;
              if (n < 0 || n > max)
                throw new Error(`Operand out of range (0..${max}): ${args[i]}`);
              if (kind === "T") {
                let d = (n - ((pc + ins.length) & 65535) + 65536) & 65535;
                if (d > 32767) d -= 65536;
                if (d < -128 || d > 127)
                  throw new Error("Relative jump out of range (-128..127)");
                n = d & 255;
              }
              if (kind === "Q") {
                if ((n & 0xf800) !== ((pc + 2) & 0xf800))
                  throw new Error(
                    "AJMP/ACALL destination outside next-instruction 2 KB page",
                  );
                bytes[0] = (ins.op & 0x1f) | ((n >> 3) & 0xe0);
              }
            }
            if (kind === "W" || kind === "#W") bytes.push((n >> 8) & 255);
            bytes.push(n & 255);
          }
        }
        if (pc < 0 || pc + bytes.length > 65536)
          throw new Error("CODE address overflow");
        if (final) {
          if (first && bytes.length) {
            result.entry = pc;
            first = false;
          }
          for (let i = 0; i < bytes.length; i++) {
            if (result.used[pc + i])
              throw new Error(`Overlapping CODE at ${hex(pc + i, 4)}H`);
            result.code[pc + i] = bytes[i];
            result.used[pc + i] = 1;
          }
          result.listing.push({
            address: pc,
            bytes,
            line: row.line,
            source: row.source,
            instruction: actual + (args.length ? " " + args.join(",") : ""),
          });
        }
        pc += bytes.length;
      } catch (e) {
        if (final)
          result.errors.push({ line: row.line, message: (e as Error).message });
      }
    }
    return before === JSON.stringify(result.symbols);
  }
  for (let i = 0; i < 32; i++) {
    if (pass(false)) {
      settled = true;
      break;
    }
  }
  if (!settled)
    result.errors.push({
      line: 1,
      message: "Symbols/layout did not converge; circular expression",
    });
  pass(true);
  return result;
}
export function listingText(a: Assembly) {
  return (
    a.source
      .split(/\r?\n/)
      .map((source, i) => {
        const l = a.listing.find((l) => l.line === i + 1);
        return `${String(i + 1).padStart(4)} ${l ? hex(l.address, 4) : "    "}  ${(l?.bytes.map((b) => hex(b)).join(" ") ?? "").padEnd(24)} ${source}${l ? " ; encoded: " + l.instruction : ""}`;
      })
      .join("\n") +
    "\n\nSYMBOLS\n" +
    Object.entries(a.symbols)
      .map(([k, v]) => `${k} = ${hex(v, 4)}H`)
      .join("\n")
  );
}
