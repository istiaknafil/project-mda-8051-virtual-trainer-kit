import { CPU8051, type Trace } from "../cpu8051/cpu";
import { hex } from "../core/isa";
import type { Image } from "../editor/formats";
export const memoryMap = [
  ["0000–6FFF", "Program/data RAM"],
  ["7000–7FFF", "ROM writer · unavailable"],
  ["8000–BFFF", "Monitor ROM · 8028H hook only"],
  ["C000–C003", "Keyboard flag · virtual"],
  ["C004–C007", "Keyboard data · virtual"],
  ["C008–C00B", "PPI / LCD · wiring unverified"],
  ["C00C–C00F", "89C51 writer · unavailable"],
  ["C010–C013", "Speaker · unavailable"],
  ["C014–C017", "Dot matrix · unavailable"],
  ["C018–C01B", "ADC · unavailable"],
  ["C01C–C01F", "CON10 · unavailable"],
  ["C020–FFFF", "User XDATA"],
];
export type Wiring = {
  dipPins: number[];
  ledPins: number[];
  activeLow: boolean;
  ledSource?: "latch" | "pins";
};
// Provisional teaching configuration. Only LED 5 -> P1.3 follows the brief.
export const defaultWiring: Wiring = {
  dipPins: [4, 5, 6, 7],
  ledPins: [7, 6, 5, 4, 3, 2, 1, 0],
  activeLow: true,
  ledSource: "latch",
};
export class Trainer {
  cpu = new CPU8051();
  used = new Uint8Array(65536);
  entry = 0;
  monitorInit = true;
  monitorHook = true;
  stopped = true;
  returned = false;
  programReady = false;
  private p1WrittenByProgram = false;
  wiring: Wiring = structuredClone(defaultWiring);
  dips = [false, false, false, false];
  address = 0x2000;
  space: "CODE" | "IRAM" | "XDATA" = "CODE";
  inputMode: "AD" | "DA" = "AD";
  private digits = "";
  keyFlag = 0;
  keyValue = 0;
  mode = "Machine code";
  history: Trace[] = [];
  serial = "";
  lcdText = Array(32).fill(" ");
  lcdCursor = 0;
  virtualLCD = false; // Explicitly opt-in virtual bus, not a claim about MDA wiring.
  constructor() {
    this.cpu.xread = (a) => this.readBus(a);
    this.cpu.xpeek = (a) => this.readBus(a, false);
    this.cpu.xwrite = (a, v) => this.writeBus(a, v);
    this.cpu.onSerial = (v) => {
      this.serial = (this.serial + String.fromCharCode(v)).slice(-8192);
    };
    this.reset();
  }
  configure(w: Wiring) {
    if (
      w.dipPins.length !== 4 ||
      w.ledPins.length !== 8 ||
      [...w.dipPins, ...w.ledPins].some(
        (n) => !Number.isInteger(n) || n < 0 || n > 7,
      ) ||
      (w.ledSource !== undefined && !["latch", "pins"].includes(w.ledSource))
    )
      throw new Error("Use 4 DIP pins and 8 LED pins, each in 0..7");
    this.wiring = { ...structuredClone(w), ledSource: w.ledSource ?? "latch" };
    this.resolve();
  }
  resolve() {
    let low = 0;
    this.dips.forEach((on, i) => {
      if (on) low |= 1 << this.wiring.dipPins[i];
    });
    this.cpu.externalLow[1] = low;
  }
  leds() {
    if (!this.programReady || !this.p1WrittenByProgram)
      return this.wiring.ledPins.map(() => false);
    const pins =
      this.wiring.ledSource === "pins"
        ? this.cpu.pins(1)
        : this.cpu.read(0x90, true);
    return this.wiring.ledPins.map((pin) =>
      this.wiring.activeLow ? !(pins & (1 << pin)) : !!(pins & (1 << pin)),
    );
  }
  get ledStatus() {
    return !this.programReady
      ? "Assemble or load machine code first"
      : !this.p1WrittenByProgram
        ? "Waiting for an instruction to write P1"
        : "P1 output written by firmware";
  }
  reset() {
    this.cpu.reset();
    this.p1WrittenByProgram = false;
    if (this.monitorInit) this.cpu.sp = 0x50;
    this.cpu.pc = this.entry;
    this.history = [];
    this.returned = false;
    this.stopped = true;
    this.resolve();
  }
  hardwareReset() {
    this.cpu.reset();
    this.p1WrittenByProgram = false;
    this.history = [];
    this.returned = false;
    this.stopped = true;
    this.resolve();
  }
  load(image: Image) {
    // Assembly failures must never make a previous image executable by accident.
    if ((image as Image & { errors?: unknown[] }).errors?.length) {
      this.invalidateProgram();
      throw new Error(
        "Assembly failed. Correct the errors and assemble again.",
      );
    }
    this.cpu.code.set(image.code);
    this.used.set(image.used);
    this.entry = image.entry;
    this.address = image.entry;
    this.programReady = image.used.some((value) => value !== 0);
    this.reset();
  }
  invalidateProgram() {
    this.programReady = false;
    this.reset();
  }
  requireProgram() {
    if (!this.programReady)
      throw new Error(
        "Assemble the current source successfully, or load machine code, before Run / Step / GO.",
      );
  }
  step() {
    this.requireProgram();
    if (this.monitorHook && this.cpu.pc === 0x8028) {
      this.returned = true;
      this.stopped = true;
      return undefined;
    }
    if (
      this.cpu.pc >= 0x7000 &&
      this.cpu.pc < 0xc000 &&
      !this.used[this.cpu.pc]
    )
      throw new Error(
        `No monitor/writer ROM installed at ${hex(this.cpu.pc, 4)}H`,
      );
    const writesBefore = this.cpu.portWrites[1];
    const trace = this.cpu.step();
    if (this.cpu.portWrites[1] !== writesBefore) this.p1WrittenByProgram = true;
    this.history.push(trace);
    if (this.history.length > 200) this.history.shift();
    if (this.monitorHook && this.cpu.pc === 0x8028) {
      this.returned = true;
      this.stopped = true;
    }
    return trace;
  }
  memoryRead() {
    if (this.space === "IRAM") {
      if (this.address > 127) throw new Error("8051 internal RAM is 00–7FH");
      return this.cpu.ram[this.address];
    }
    return this.space === "CODE"
      ? this.cpu.code[this.address]
      : this.cpu.readX(this.address);
  }
  memoryWrite(value: number) {
    if (this.space === "IRAM") {
      if (this.address > 127) throw new Error("8051 internal RAM is 00–7FH");
      this.cpu.write(this.address, value);
    } else if (this.space === "CODE") {
      this.writeCode(this.address, value);
    } else this.cpu.writeX(this.address, value);
  }
  writeCode(address: number, value: number) {
    this.cpu.code[address] = value;
    this.used[address] = 1;
    this.programReady = true;
    this.p1WrittenByProgram = false;
  }
  key(key: string) {
    this.keyValue =
      key.length === 1 && /[0-9A-F]/.test(key)
        ? parseInt(key, 16)
        : ({
            RES: 0x10,
            AD: 0x11,
            DA: 0x12,
            GO: 0x13,
            STP: 0x14,
            INT: 0x15,
            T0: 0x16,
            "+": 0x17,
            "-": 0x18,
          }[key] ?? 0xff);
    this.keyFlag = 1;
    if (key === "RES") {
      this.reset();
      this.digits = "";
    } else if (key === "AD" || key === "DA") {
      this.inputMode = key;
      this.digits = "";
    } else if (key === "+" || key === "-") {
      this.address = (this.address + (key === "+" ? 1 : -1)) & 65535;
      this.digits = "";
    } else if (key === "GO") {
      this.requireProgram();
      this.cpu.pc = this.address;
      this.returned = false;
      this.stopped = false;
    } else if (key === "STP") {
      this.stopped = true;
      this.step();
    } else if (key === "INT") {
      this.cpu.setInterruptPin(0, false);
      this.cpu.setInterruptPin(0, true);
    } else if (key === "T0") this.cpu.pulseCounter(0);
    else if (/^[0-9A-F]$/.test(key)) {
      const n = this.inputMode === "AD" ? 4 : 2;
      this.digits = (this.digits + key).slice(-n);
      if (this.inputMode === "AD") this.address = parseInt(this.digits, 16);
      else if (this.digits.length === 2) {
        this.memoryWrite(parseInt(this.digits, 16));
        this.digits = "";
      }
    }
  }
  lcd() {
    if (this.returned)
      return [
        `A=${hex(this.cpu.a)} B=${hex(this.cpu.b)} PSW=${hex(this.cpu.psw)}`.padEnd(16),
        `SP=${hex(this.cpu.sp)} DPTR=${hex(this.cpu.dptr, 4)}`.padEnd(16),
      ];
    if (this.virtualLCD)
      return [
        this.lcdText.slice(0, 16).join(""),
        this.lcdText.slice(16).join(""),
      ];
    let value = "--";
    try {
      value = hex(this.memoryRead());
    } catch {}
    return [
      `${this.space} ${hex(this.address, 4)} ${this.inputMode}`
        .padEnd(16)
        .slice(0, 16),
      `${value}  PC=${hex(this.cpu.pc, 4)}`.padEnd(16).slice(0, 16),
    ];
  }
  command(input: string) {
    const [name, ...args] = input.trim().toUpperCase().split(/\s+/);
    const value = (s: string | undefined, max = 65535) => {
      if (!s || !/^[\dA-F]{1,4}$/.test(s) || parseInt(s, 16) > max)
        throw new Error(
          "Use hexadecimal values within the selected memory range",
        );
      return parseInt(s, 16);
    };
    if (name === "HELP")
      return "Virtual monitor: SPACE CODE|IRAM|XDATA; AD address; DA byte; READ [address]; GO [address]; STP; STOP; RES; INT; T0; +; -; REGS. Values are hex. This is not the original MDA serial protocol.";
    if (name === "SPACE") {
      if (!["CODE", "IRAM", "XDATA"].includes(args[0]))
        throw new Error("SPACE CODE|IRAM|XDATA");
      this.space = args[0] as typeof this.space;
    } else if (name === "AD") {
      this.address = value(args[0]);
      this.inputMode = "AD";
    } else if (name === "DA") {
      this.memoryWrite(value(args[0], 255));
      this.inputMode = "DA";
    } else if (name === "READ") {
      if (args[0]) this.address = value(args[0]);
      return `${this.space} ${hex(this.address, 4)}: ${hex(this.memoryRead())}`;
    } else if (name === "GO") {
      if (args[0]) this.address = value(args[0]);
      this.key("GO");
    } else if (name === "STOP") this.stopped = true;
    else if (name === "REGS")
      return Object.entries(this.cpu.snapshot())
        .map(([k, v]) => `${k}=${hex(v, k === "PC" || k === "DPTR" ? 4 : 2)}`)
        .join(" ");
    else if (["STP", "RES", "INT", "T0", "+", "-"].includes(name))
      this.key(name);
    else throw new Error("Unknown virtual monitor command. Enter HELP.");
    return this.lcd().join(" | ");
  }
  private readBus(a: number, sideEffects = true): number | undefined {
    if (a >= 0xc000 && a <= 0xc003) return this.keyFlag;
    if (a >= 0xc004 && a <= 0xc007) {
      if (sideEffects) this.keyFlag = 0;
      return this.keyValue;
    }
    if (this.virtualLCD && (a === 0xc008 || a === 0xc009)) return 0;
    if ((a >= 0x7000 && a < 0xc000) || (a >= 0xc008 && a <= 0xc01f))
      throw new Error(
        `Board device at ${hex(a, 4)}H is unavailable or wiring is unverified`,
      );
    return undefined;
  }
  private writeBus(a: number, v: number) {
    if (this.virtualLCD && a === 0xc008) {
      if (v === 1) {
        this.lcdText.fill(" ");
        this.lcdCursor = 0;
      } else if (v === 2) this.lcdCursor = 0;
      else if (v & 128)
        this.lcdCursor = (v & 127) >= 64 ? 16 + ((v & 127) - 64) : v & 127;
      return true;
    }
    if (this.virtualLCD && a === 0xc009) {
      if (this.lcdCursor < 32)
        this.lcdText[this.lcdCursor] = String.fromCharCode(v);
      this.lcdCursor++;
      return true;
    }
    if (a >= 0xc000 && a <= 0xc007) return true;
    if ((a >= 0x7000 && a < 0xc000) || (a >= 0xc008 && a <= 0xc01f))
      throw new Error(
        `Board device at ${hex(a, 4)}H is unavailable or wiring is unverified`,
      );
    return false;
  }
}
