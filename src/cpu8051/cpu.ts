import { decode, SFR, hex } from "../core/isa";
export type Change = {
  space: string;
  address: number;
  before: number;
  after: number;
};
export type Trace = {
  pc: number;
  text: string;
  bytes: number[];
  cycles: number;
  before: Record<string, number>;
  after: Record<string, number>;
  changes: Change[];
  explanation: string;
};
export type Profile = "8051" | "8031" | "8751";
export class CPU8051 {
  readonly code = new Uint8Array(65536);
  readonly ram = new Uint8Array(128);
  readonly sfr = new Uint8Array(128);
  readonly xdata = new Uint8Array(65536);
  readonly externalLow = new Uint8Array(4);
  readonly pullups = new Uint8Array([0, 255, 255, 255]);
  // Counts real port writes, including instructions that rewrite the same value.
  readonly portWrites = new Uint32Array(4);
  pc = 0;
  cycles = 0;
  instructions = 0;
  profile: Profile = "8051";
  clock = 11059200;
  xread?: (address: number) => number | undefined;
  xpeek?: (address: number) => number | undefined;
  xwrite?: (address: number, value: number) => boolean;
  onSerial?: (value: number) => void;
  private tx: number | undefined;
  private txTicks = 0;
  private changes: Change[] = [];
  private active: number[] = [];
  private pulses = [0, 0];
  private rx = 0;
  private irqControlWritten = false;
  constructor() {
    this.reset();
  }
  reset() {
    this.ram.fill(0);
    this.sfr.fill(0);
    this.portWrites.fill(0);
    for (const p of [0x80, 0x90, 0xa0, 0xb0]) this.sfr[p - 128] = 255;
    this.sfr[1] = 7;
    this.pc = 0;
    this.cycles = 0;
    this.instructions = 0;
    this.active = [];
    this.pulses = [0, 0];
    this.tx = undefined;
    this.txTicks = 0;
    this.rx = 0;
  }
  get a() {
    return this.sfr[0x60];
  }
  set a(v: number) {
    this.write(0xe0, v);
  }
  get b() {
    return this.sfr[0x70];
  }
  set b(v: number) {
    this.write(0xf0, v);
  }
  get psw() {
    return this.sfr[0x50];
  }
  set psw(v: number) {
    this.write(0xd0, v);
  }
  get carry() {
    return this.psw >> 7;
  }
  set carry(v: number) {
    this.psw = (this.psw & 127) | ((v & 1) << 7);
  }
  get sp() {
    return this.sfr[1];
  }
  set sp(v: number) {
    this.write(0x81, v);
  }
  get dptr() {
    return this.sfr[3] * 256 + this.sfr[2];
  }
  set dptr(v: number) {
    this.write(0x82, v);
    this.write(0x83, v >> 8);
  }
  register(n: number) {
    return ((this.psw >> 3) & 3) * 8 + n;
  }
  getR(n: number) {
    return this.ram[this.register(n)];
  }
  setR(n: number, v: number) {
    this.write(this.register(n), v);
  }
  pins(port: number) {
    const latch = this.sfr[port * 16];
    return (
      latch & ~this.externalLow[port] & (port === 0 ? this.pullups[0] : 255)
    );
  }
  read(address: number, latch = false) {
    address &= 255;
    if (address < 128) return this.ram[address];
    if ([0x80, 0x90, 0xa0, 0xb0].includes(address) && !latch)
      return this.pins((address - 128) / 16);
    if (address === 0x99 && !latch) return this.rx;
    return this.sfr[address - 128];
  }
  private track(space: string, address: number, before: number, after: number) {
    if (before !== after) this.changes.push({ space, address, before, after });
  }
  write(address: number, value: number) {
    address &= 255;
    value &= 255;
    if (address === 0xa8 || address === 0xb8) this.irqControlWritten = true;
    const memory = address < 128 ? this.ram : this.sfr,
      index = address < 128 ? address : address - 128;
    this.track(address < 128 ? "IRAM" : "SFR", address, memory[index], value);
    memory[index] = value;
    if ([0x80, 0x90, 0xa0, 0xb0].includes(address))
      this.portWrites[(address - 0x80) / 16]++;
    if (address === 0x99) {
      this.tx = value;
      this.txTicks = 0;
    }
  }
  indirect(address: number) {
    return address < 128 ? this.ram[address] : 0xff;
  }
  writeIndirect(address: number, value: number) {
    if (address < 128) this.write(address, value);
    else
      throw new Error(
        `Indirect RAM ${hex(address)}H is absent on ${this.profile}`,
      );
  }
  bitRead(bit: number, latch = false) {
    return (
      (this.read(bit < 128 ? 32 + (bit >> 3) : bit & 0xf8, latch) >>
        (bit & 7)) &
      1
    );
  }
  bitWrite(bit: number, value: number) {
    const address = bit < 128 ? 32 + (bit >> 3) : bit & 0xf8,
      mask = 1 << (bit & 7);
    this.write(
      address,
      (this.read(address, true) & ~mask) | (value ? mask : 0),
    );
  }
  push(value: number) {
    this.sp = (this.sp + 1) & 255;
    this.writeIndirect(this.sp, value);
  }
  pop() {
    const value = this.indirect(this.sp);
    this.sp = (this.sp - 1) & 255;
    return value;
  }
  private call(target: number) {
    this.push(this.pc & 255);
    this.push(this.pc >> 8);
    this.pc = target;
  }
  private ret() {
    const hi = this.pop();
    this.pc = (hi << 8) | this.pop();
  }
  readX(address: number) {
    return this.xread?.(address) ?? this.xdata[address];
  }
  peekX(address: number) {
    return this.xpeek?.(address) ?? this.xdata[address];
  }
  writeX(address: number, value: number) {
    value &= 255;
    const before = this.peekX(address);
    if (!this.xwrite?.(address, value)) this.xdata[address] = value;
    this.track("XDATA", address, before, value);
  }
  snapshot() {
    const s: Record<string, number> = { PC: this.pc };
    for (const [name, address] of Object.entries(SFR))
      s[name] = this.read(address, true);
    s.A = this.a;
    s.DPTR = this.dptr;
    for (let i = 0; i < 8; i++) s[`R${i}`] = this.getR(i);
    for (let i = 0; i < 4; i++) s[`P${i}_PIN`] = this.pins(i);
    return s;
  }
  pulseCounter(timer: 0 | 1) {
    this.pulses[timer]++;
  }
  setInterruptPin(index: 0 | 1, low: boolean) {
    const mask = 1 << (index + 2),
      was = !!(this.externalLow[3] & mask);
    if (low) this.externalLow[3] |= mask;
    else this.externalLow[3] &= ~mask;
    if (this.bitRead(0x88 + index * 2)) {
      if (low && !was) this.bitWrite(0x89 + index * 2, 1);
    } else this.bitWrite(0x89 + index * 2, low ? 1 : 0);
  }
  receive(value: number) {
    if (!this.bitRead(0x9c)) throw new Error("UART receiver disabled (REN=0)");
    this.rx = value & 255;
    this.bitWrite(0x98, 1);
  }
  private timerIncrement(timer: number, mode: number) {
    const tl = 0x8a + timer,
      th = 0x8c + timer;
    let overflow = false;
    if (mode === 0) {
      let v = (this.read(th) << 5) | (this.read(tl) & 31);
      v++;
      overflow = v > 8191;
      this.write(th, v >> 5);
      this.write(tl, (this.read(tl) & 0xe0) | (v & 31));
    } else if (mode === 1) {
      let v = (this.read(th) << 8) | this.read(tl);
      v++;
      overflow = v > 65535;
      this.write(th, v >> 8);
      this.write(tl, v);
    } else if (mode === 2) {
      const v = this.read(tl) + 1;
      overflow = v > 255;
      this.write(tl, overflow ? this.read(th) : v);
    }
    if (overflow) this.bitWrite(timer ? 0x8f : 0x8d, 1);
    return overflow;
  }
  private serialTick(timer1Overflow: boolean) {
    if (this.tx === undefined) return;
    const mode = this.read(0x98) >> 6;
    let tick = false,
      limit = 0;
    if (mode === 0) {
      tick = true;
      limit = 8;
    } else if (mode === 2) {
      tick = true;
      limit = this.read(0x87) & 128 ? 27 : 54;
    } else {
      tick = timer1Overflow;
      limit = (this.read(0x87) & 128 ? 16 : 32) * (mode === 1 ? 10 : 11);
    }
    if (tick && ++this.txTicks >= limit) {
      const value = this.tx;
      this.tx = undefined;
      this.bitWrite(0x99, 1);
      this.onSerial?.(value);
    }
  }
  advance(count: number) {
    for (let c = 0; c < count; c++) {
      const tmod = this.read(0x89),
        split = (tmod & 3) === 3;
      let ov1 = false;
      for (let t = 0; t < 2; t++) {
        const m = (tmod >> (t * 4)) & 15,
          mode = m & 3;
        let enabled = !!this.bitRead(t ? 0x8e : 0x8c);
        if (m & 8) enabled = enabled && !!(this.pins(3) & (1 << (t + 2)));
        const counter = !!(m & 4);
        let ticks = counter ? this.pulses[t] : 1;
        this.pulses[t] = 0;
        if (split && t === 1) enabled = mode !== 3; // Timer 1 can still clock UART in split mode.
        if (enabled) {
          while (ticks-- > 0) {
            if (split && t === 0) {
              const v = this.read(0x8a) + 1;
              this.write(0x8a, v);
              if (v > 255) this.bitWrite(0x8d, 1);
            } else {
              const oldFlag = this.bitRead(0x8f),
                ov = this.timerIncrement(t, mode);
              if (t === 1) {
                ov1 = ov1 || ov;
                if (split) this.bitWrite(0x8f, oldFlag);
              }
            }
          }
        }
      }
      if (split && this.bitRead(0x8e)) {
        const v = this.read(0x8c) + 1;
        this.write(0x8c, v);
        if (v > 255) this.bitWrite(0x8f, 1);
      }
      this.serialTick(ov1);
      this.cycles++;
    }
  }
  private interrupt() {
    const ie = this.read(0xa8);
    if (!(ie & 128)) return false;
    for (let i = 0; i < 2; i++)
      if (!this.bitRead(0x88 + i * 2))
        this.bitWrite(0x89 + i * 2, this.pins(3) & (1 << (i + 2)) ? 0 : 1);
    const pending = [
      this.bitRead(0x89),
      this.bitRead(0x8d),
      this.bitRead(0x8b),
      this.bitRead(0x8f),
      this.read(0x98) & 3,
    ];
    for (let priority = 1; priority >= 0; priority--) {
      if ((this.active.at(-1) ?? -1) >= priority) continue;
      for (let i = 0; i < 5; i++) {
        if (
          !(ie & (1 << i)) ||
          !pending[i] ||
          ((this.read(0xb8) >> i) & 1) !== priority
        )
          continue;
        this.write(0x87, this.read(0x87) & ~1);
        this.call([3, 11, 19, 27, 35][i]);
        this.active.push(priority);
        if (i === 1) this.bitWrite(0x8d, 0);
        if (i === 3) this.bitWrite(0x8f, 0);
        if (i === 0 && this.bitRead(0x88)) this.bitWrite(0x89, 0);
        if (i === 2 && this.bitRead(0x8a)) this.bitWrite(0x8b, 0);
        this.advance(2);
        return true;
      }
    }
    return false;
  }
  step(): Trace {
    if (this.read(0x87) & 2)
      throw new Error("CPU is in power-down. Reset to resume.");
    this.changes = [];
    this.irqControlWritten = false;
    const before = this.snapshot(),
      pc = this.pc,
      startCycles = this.cycles;
    if (this.read(0x87) & 1) {
      this.advance(1);
      this.interrupt();
      return {
        pc,
        text: "IDLE",
        bytes: [],
        cycles: this.cycles - startCycles,
        before,
        after: this.snapshot(),
        changes: this.changes,
        explanation: "Timers continue while CPU is idle.",
      };
    }
    const { ins, values, text } = decode(this.code, this.pc);
    const bytes = Array.from(
      { length: ins.length },
      (_, i) => this.code[(pc + i) & 65535],
    );
    this.pc = (this.pc + ins.length) & 65535;
    const get = (i: number, latch = false): number => {
      const k = ins.args[i],
        v = values[i];
      if (k === "A") return this.a;
      if (k === "C") return this.carry;
      if (k === "DPTR") return this.dptr;
      if (k === "D") return this.read(v, latch);
      if (k === "B") return this.bitRead(v, latch);
      if (k === "/B") return 1 - this.bitRead(v);
      if (/^R\d$/.test(k)) return this.getR(+k[1]);
      if (/^@R/.test(k)) return this.indirect(this.getR(+k[2]));
      return v;
    };
    const put = (i: number, v: number) => {
      const k = ins.args[i],
        addr = values[i];
      if (k === "A") this.a = v;
      else if (k === "C") this.carry = v;
      else if (k === "DPTR") this.dptr = v;
      else if (k === "D") this.write(addr, v);
      else if (k === "B") this.bitWrite(addr, v & 1);
      else if (/^R\d$/.test(k)) this.setR(+k[1], v);
      else if (/^@R/.test(k)) this.writeIndirect(this.getR(+k[2]), v);
      else throw new Error(`Invalid destination ${k}`);
    };
    const flag = (mask: number, on: boolean) => {
      this.psw = on ? this.psw | mask : this.psw & ~mask;
    };
    switch (ins.name) {
      case "NOP":
        break;
      case "MOV":
        put(0, get(1));
        break;
      case "MOVC":
        this.a =
          this.code[
            ((ins.args[1] === "@A+PC" ? this.pc : this.dptr) + this.a) & 65535
          ];
        break;
      case "MOVX": {
        const k = ins.args[ins.args[0] === "A" ? 1 : 0],
          addr =
            k === "@DPTR"
              ? this.dptr
              : (this.read(0xa0, true) << 8) | this.getR(+k[2]);
        if (ins.args[0] === "A") this.a = this.readX(addr);
        else this.writeX(addr, this.a);
        break;
      }
      case "INC":
        put(0, get(0, true) + 1);
        break;
      case "DEC":
        put(0, get(0, true) - 1);
        break;
      case "ADD":
      case "ADDC":
      case "SUBB": {
        const a = this.a,
          b = get(1),
          carry = ins.name === "ADD" ? 0 : this.carry,
          sub = ins.name === "SUBB";
        const value = sub ? a - b - carry : a + b + carry;
        flag(128, sub ? value < 0 : value > 255);
        flag(
          64,
          sub ? (a & 15) < (b & 15) + carry : (a & 15) + (b & 15) + carry > 15,
        );
        flag(
          4,
          !!((sub ? (a ^ b) & (a ^ value) : ~(a ^ b) & (a ^ value)) & 128),
        );
        this.a = value;
        break;
      }
      case "MUL": {
        const v = this.a * this.b;
        this.a = v;
        this.b = v >> 8;
        this.carry = 0;
        flag(4, v > 255);
        break;
      }
      case "DIV": {
        const a = this.a,
          b = this.b;
        this.carry = 0;
        flag(4, b === 0);
        if (b) {
          this.a = Math.floor(a / b);
          this.b = a % b;
        }
        break;
      }
      case "DA": {
        let a = this.a;
        const cy = this.carry;
        if ((a & 15) > 9 || this.psw & 64) a += 6;
        if (a > 0x9f || cy) a += 0x60;
        this.carry = cy || a > 255 ? 1 : 0;
        this.a = a;
        break;
      }
      case "ANL":
        put(0, get(0, true) & get(1));
        break;
      case "ORL":
        put(0, get(0, true) | get(1));
        break;
      case "XRL":
        put(0, get(0, true) ^ get(1));
        break;
      case "CLR":
        put(0, 0);
        break;
      case "SETB":
        put(0, 1);
        break;
      case "CPL":
        put(0, ins.args[0] === "A" ? ~get(0) : 1 - get(0, true));
        break;
      case "SWAP":
        this.a = (this.a << 4) | (this.a >> 4);
        break;
      case "RL":
        this.a = (this.a << 1) | (this.a >> 7);
        break;
      case "RR":
        this.a = (this.a >> 1) | (this.a << 7);
        break;
      case "RLC": {
        const a = this.a,
          c = this.carry;
        this.carry = a >> 7;
        this.a = (a << 1) | c;
        break;
      }
      case "RRC": {
        const a = this.a,
          c = this.carry;
        this.carry = a & 1;
        this.a = (a >> 1) | (c << 7);
        break;
      }
      case "XCH": {
        const a = this.a,
          v = get(1);
        put(1, a);
        this.a = v;
        break;
      }
      case "XCHD": {
        const a = this.a,
          v = get(1);
        put(1, (v & 240) | (a & 15));
        this.a = (a & 240) | (v & 15);
        break;
      }
      case "PUSH":
        this.sp = (this.sp + 1) & 255;
        this.writeIndirect(this.sp, get(0));
        break;
      case "POP": {
        const v = this.pop();
        put(0, v);
        break;
      }
      case "AJMP":
      case "LJMP":
      case "SJMP":
        this.pc = get(0);
        break;
      case "JMP":
        this.pc = (this.a + this.dptr) & 65535;
        break;
      case "ACALL":
      case "LCALL":
        this.call(get(0));
        break;
      case "RET":
        this.ret();
        break;
      case "RETI":
        this.ret();
        this.active.pop();
        break;
      case "JC":
        if (this.carry) this.pc = get(0);
        break;
      case "JNC":
        if (!this.carry) this.pc = get(0);
        break;
      case "JZ":
        if (!this.a) this.pc = get(0);
        break;
      case "JNZ":
        if (this.a) this.pc = get(0);
        break;
      case "JB":
        if (get(0)) this.pc = get(1);
        break;
      case "JNB":
        if (!get(0)) this.pc = get(1);
        break;
      case "JBC":
        if (get(0, true)) {
          put(0, 0);
          this.pc = get(1);
        }
        break;
      case "CJNE": {
        const a = get(0),
          b = get(1);
        this.carry = a < b ? 1 : 0;
        if (a !== b) this.pc = get(2);
        break;
      }
      case "DJNZ": {
        const v = (get(0, true) - 1) & 255;
        put(0, v);
        if (v) this.pc = get(1);
        break;
      }
      default:
        throw new Error(`Instruction not implemented: ${text}`);
    }
    let parity = 0;
    for (let v = this.a; v; v >>= 1) parity ^= v & 1;
    this.psw = (this.psw & 254) | parity;
    this.advance(ins.cycles);
    this.instructions++;
    // RETI and writes to interrupt control registers require a following instruction
    // before another interrupt is accepted (classic MCS-51 polling rule).
    if (ins.name !== "RETI" && !this.irqControlWritten) this.interrupt();
    const explanations: Record<string, string> = {
      MOV: "Copy the source value to the destination.",
      MOVX: "Transfer a byte through the external data address space.",
      MOVC: "Read a byte from program memory.",
      SWAP: "Exchange the upper and lower four bits of the accumulator.",
      ORL: "Apply bitwise OR to the operands.",
      ANL: "Apply bitwise AND to the operands.",
      XRL: "Apply bitwise exclusive OR.",
      DJNZ: "Decrement the operand and branch if the result is nonzero.",
      CJNE: "Compare operands, set CY for unsigned less-than, and branch if unequal.",
      RETI: "Return from interrupt and release the interrupt priority level.",
    };
    return {
      pc,
      text,
      bytes,
      cycles: this.cycles - startCycles,
      before,
      after: this.snapshot(),
      changes: this.changes,
      explanation:
        explanations[ins.name] ??
        `${ins.name} executed from CODE memory; see the register and memory changes below.`,
    };
  }
}
