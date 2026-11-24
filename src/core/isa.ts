// Intel MCS-51 opcode descriptions. D=direct, I=immediate, B=bit,
// T=relative destination, W=16-bit destination, Q=11-bit destination.
export type Instruction = {
  op: number;
  name: string;
  args: string[];
  length: number;
  cycles: number;
  order: number[];
};
export const ISA: Array<Instruction | undefined> = Array(256);
const width = (a: string) =>
  a === "W" || a === "#W"
    ? 2
    : ["D", "I", "B", "/B", "T", "Q"].includes(a)
      ? 1
      : 0;
function def(
  op: number,
  name: string,
  args: string[] = [],
  cycles = 1,
  order?: number[],
) {
  const indices = order ?? args.map((_, i) => i).filter((i) => width(args[i]));
  ISA[op] = {
    op,
    name,
    args,
    length: 1 + args.reduce((n, a) => n + width(a), 0),
    cycles,
    order: indices,
  };
}
function group(base: number, name: string, prefix: string[] = [], cycles = 1) {
  def(base, name, [...prefix, "I"], cycles);
  def(base + 1, name, [...prefix, "D"], cycles);
  for (let i = 0; i < 2; i++)
    def(base + 2 + i, name, [...prefix, `@R${i}`], cycles);
  for (let i = 0; i < 8; i++)
    def(base + 4 + i, name, [...prefix, `R${i}`], cycles);
}
for (let p = 0; p < 8; p++) {
  def(0x01 + p * 32, "AJMP", ["Q"], 2);
  def(0x11 + p * 32, "ACALL", ["Q"], 2);
}
def(0, "NOP");
def(2, "LJMP", ["W"], 2);
def(0x12, "LCALL", ["W"], 2);
def(0x22, "RET", [], 2);
def(0x32, "RETI", [], 2);
for (const [op, name] of [
  [3, "RR"],
  [0x13, "RRC"],
  [0x23, "RL"],
  [0x33, "RLC"],
  [0xc4, "SWAP"],
  [0xd4, "DA"],
  [0xe4, "CLR"],
  [0xf4, "CPL"],
] as const)
  def(op, name, ["A"]);
for (const [base, name] of [
  [4, "INC"],
  [0x14, "DEC"],
] as const) {
  def(base, name, ["A"]);
  def(base + 1, name, ["D"]);
  for (let i = 0; i < 2; i++) def(base + 2 + i, name, [`@R${i}`]);
  for (let i = 0; i < 8; i++) def(base + 4 + i, name, [`R${i}`]);
}
def(0xa3, "INC", ["DPTR"], 2);
for (const [op, name] of [
  [0x10, "JBC"],
  [0x20, "JB"],
  [0x30, "JNB"],
] as const)
  def(op, name, ["B", "T"], 2);
for (const [op, name] of [
  [0x40, "JC"],
  [0x50, "JNC"],
  [0x60, "JZ"],
  [0x70, "JNZ"],
  [0x80, "SJMP"],
] as const)
  def(op, name, ["T"], 2);
group(0x24, "ADD", ["A"]);
group(0x34, "ADDC", ["A"]);
group(0x94, "SUBB", ["A"]);
for (const [base, name] of [
  [0x40, "ORL"],
  [0x50, "ANL"],
  [0x60, "XRL"],
] as const) {
  def(base + 2, name, ["D", "A"]);
  def(base + 3, name, ["D", "I"], 2);
  group(base + 4, name, ["A"]);
}
def(0x72, "ORL", ["C", "B"], 2);
def(0x82, "ANL", ["C", "B"], 2);
def(0xa0, "ORL", ["C", "/B"], 2);
def(0xb0, "ANL", ["C", "/B"], 2);
def(0x73, "JMP", ["@A+DPTR"], 2);
group(0x74, "MOV", ["A"]);
// 75..7F are MOV destination,#data, not the accumulator source family.
def(0x75, "MOV", ["D", "I"], 2);
for (let i = 0; i < 2; i++) def(0x76 + i, "MOV", [`@R${i}`, "I"]);
for (let i = 0; i < 8; i++) def(0x78 + i, "MOV", [`R${i}`, "I"]);
def(0x83, "MOVC", ["A", "@A+PC"], 2);
def(0x93, "MOVC", ["A", "@A+DPTR"], 2);
def(0x84, "DIV", ["AB"], 4);
def(0xa4, "MUL", ["AB"], 4);
def(0x85, "MOV", ["D", "D"], 2, [1, 0]);
for (let i = 0; i < 2; i++) def(0x86 + i, "MOV", ["D", `@R${i}`], 2);
for (let i = 0; i < 8; i++) def(0x88 + i, "MOV", ["D", `R${i}`], 2);
def(0x90, "MOV", ["DPTR", "#W"], 2);
def(0x92, "MOV", ["B", "C"], 2);
def(0xa2, "MOV", ["C", "B"]);
for (let i = 0; i < 2; i++) def(0xa6 + i, "MOV", [`@R${i}`, "D"], 2);
for (let i = 0; i < 8; i++) def(0xa8 + i, "MOV", [`R${i}`, "D"], 2);
def(0xb2, "CPL", ["B"]);
def(0xb3, "CPL", ["C"]);
def(0xc2, "CLR", ["B"]);
def(0xc3, "CLR", ["C"]);
def(0xd2, "SETB", ["B"]);
def(0xd3, "SETB", ["C"]);
def(0xb4, "CJNE", ["A", "I", "T"], 2);
def(0xb5, "CJNE", ["A", "D", "T"], 2);
for (let i = 0; i < 2; i++) def(0xb6 + i, "CJNE", [`@R${i}`, "I", "T"], 2);
for (let i = 0; i < 8; i++) def(0xb8 + i, "CJNE", [`R${i}`, "I", "T"], 2);
def(0xc0, "PUSH", ["D"], 2);
def(0xd0, "POP", ["D"], 2);
def(0xc5, "XCH", ["A", "D"]);
for (let i = 0; i < 2; i++) def(0xc6 + i, "XCH", ["A", `@R${i}`]);
for (let i = 0; i < 8; i++) def(0xc8 + i, "XCH", ["A", `R${i}`]);
def(0xd5, "DJNZ", ["D", "T"], 2);
for (let i = 0; i < 2; i++) def(0xd6 + i, "XCHD", ["A", `@R${i}`]);
for (let i = 0; i < 8; i++) def(0xd8 + i, "DJNZ", [`R${i}`, "T"], 2);
def(0xe0, "MOVX", ["A", "@DPTR"], 2);
def(0xf0, "MOVX", ["@DPTR", "A"], 2);
for (let i = 0; i < 2; i++) {
  def(0xe2 + i, "MOVX", ["A", `@R${i}`], 2);
  def(0xf2 + i, "MOVX", [`@R${i}`, "A"], 2);
}
def(0xe5, "MOV", ["A", "D"]);
def(0xf5, "MOV", ["D", "A"]);
for (let i = 0; i < 2; i++) {
  def(0xe6 + i, "MOV", ["A", `@R${i}`]);
  def(0xf6 + i, "MOV", [`@R${i}`, "A"]);
}
for (let i = 0; i < 8; i++) {
  def(0xe8 + i, "MOV", ["A", `R${i}`]);
  def(0xf8 + i, "MOV", [`R${i}`, "A"]);
}
export const SFR: Record<string, number> = {
  P0: 0x80,
  SP: 0x81,
  DPL: 0x82,
  DPH: 0x83,
  PCON: 0x87,
  TCON: 0x88,
  TMOD: 0x89,
  TL0: 0x8a,
  TL1: 0x8b,
  TH0: 0x8c,
  TH1: 0x8d,
  P1: 0x90,
  SCON: 0x98,
  SBUF: 0x99,
  P2: 0xa0,
  IE: 0xa8,
  P3: 0xb0,
  IP: 0xb8,
  PSW: 0xd0,
  ACC: 0xe0,
  B: 0xf0,
};
export const BITS: Record<string, number> = {
  CY: 0xd7,
  AC: 0xd6,
  F0: 0xd5,
  RS1: 0xd4,
  RS0: 0xd3,
  OV: 0xd2,
  P: 0xd0,
  IT0: 0x88,
  IE0: 0x89,
  IT1: 0x8a,
  IE1: 0x8b,
  TR0: 0x8c,
  TF0: 0x8d,
  TR1: 0x8e,
  TF1: 0x8f,
  RI: 0x98,
  TI: 0x99,
  RB8: 0x9a,
  TB8: 0x9b,
  REN: 0x9c,
  SM2: 0x9d,
  SM1: 0x9e,
  SM0: 0x9f,
  EX0: 0xa8,
  ET0: 0xa9,
  EX1: 0xaa,
  ET1: 0xab,
  ES: 0xac,
  EA: 0xaf,
};
export const hex = (n: number, width = 2) =>
  (n >>> 0).toString(16).toUpperCase().padStart(width, "0");
export function decode(code: Uint8Array, pc: number) {
  const ins = ISA[code[pc]];
  if (!ins) throw new Error(`Reserved opcode A5 at ${hex(pc, 4)}H`);
  const values: number[] = ins.args.map(() => 0);
  let pos = (pc + 1) & 65535;
  for (const i of ins.order) {
    const a = ins.args[i];
    let v = code[pos];
    pos = (pos + 1) & 65535;
    if (a === "W" || a === "#W") {
      v = v * 256 + code[pos];
      pos = (pos + 1) & 65535;
    }
    if (a === "Q") v = ((pc + 2) & 0xf800) | ((ins.op & 0xe0) << 3) | v;
    if (a === "T") v = (pc + ins.length + (v > 127 ? v - 256 : v)) & 65535;
    values[i] = v;
  }
  const args = ins.args.map((a, i) =>
    a === "I" || a === "#W"
      ? `#${hex(values[i], a === "#W" ? 4 : 2)}H`
      : ["D", "B", "/B", "T", "W", "Q"].includes(a)
        ? `${a === "/B" ? "/" : ""}${hex(values[i], ["T", "W", "Q"].includes(a) ? 4 : 2)}H`
        : a,
  );
  return {
    ins,
    values,
    text: ins.name + (args.length ? " " + args.join(",") : ""),
  };
}
