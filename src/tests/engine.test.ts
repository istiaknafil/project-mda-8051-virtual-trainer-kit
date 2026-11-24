import { describe, it, expect } from "vitest";
import { assemble, expression } from "../assembler";
import { CPU8051 } from "../cpu8051/cpu";
import { ISA, decode } from "../core/isa";
import { Trainer } from "../board/trainer";
import { examples } from "../experiments/examples";
import {
  parseHex,
  exportHex,
  binaryImage,
  exportBinary,
} from "../editor/formats";
import externalHex from "../../fixtures/external-sdcc.ihx?raw";
function program(source: string) {
  const image = assemble(source);
  expect(image.errors, source).toEqual([]);
  const cpu = new CPU8051();
  cpu.code.set(image.code);
  cpu.pc = image.entry;
  return cpu;
}
function run(source: string, count: number) {
  const c = program(source);
  for (let i = 0; i < count; i++) c.step();
  return c;
}
// Independent opcode matrix, transcribed from the standard MCS-51 encoding map.
// This fixture does not derive expected opcodes or lengths from the implementation.
const matrix = [
  "NOP|AJMP 0030H|LJMP 0030H|RR A|INC A|INC 30H|INC @R0|INC @R1|INC R0|INC R1|INC R2|INC R3|INC R4|INC R5|INC R6|INC R7",
  "JBC 20H,$|ACALL 0030H|LCALL 0030H|RRC A|DEC A|DEC 30H|DEC @R0|DEC @R1|DEC R0|DEC R1|DEC R2|DEC R3|DEC R4|DEC R5|DEC R6|DEC R7",
  "JB 20H,$|AJMP 0130H|RET|RL A|ADD A,#30H|ADD A,30H|ADD A,@R0|ADD A,@R1|ADD A,R0|ADD A,R1|ADD A,R2|ADD A,R3|ADD A,R4|ADD A,R5|ADD A,R6|ADD A,R7",
  "JNB 20H,$|ACALL 0130H|RETI|RLC A|ADDC A,#30H|ADDC A,30H|ADDC A,@R0|ADDC A,@R1|ADDC A,R0|ADDC A,R1|ADDC A,R2|ADDC A,R3|ADDC A,R4|ADDC A,R5|ADDC A,R6|ADDC A,R7",
  "JC $|AJMP 0230H|ORL 30H,A|ORL 30H,#30H|ORL A,#30H|ORL A,30H|ORL A,@R0|ORL A,@R1|ORL A,R0|ORL A,R1|ORL A,R2|ORL A,R3|ORL A,R4|ORL A,R5|ORL A,R6|ORL A,R7",
  "JNC $|ACALL 0230H|ANL 30H,A|ANL 30H,#30H|ANL A,#30H|ANL A,30H|ANL A,@R0|ANL A,@R1|ANL A,R0|ANL A,R1|ANL A,R2|ANL A,R3|ANL A,R4|ANL A,R5|ANL A,R6|ANL A,R7",
  "JZ $|AJMP 0330H|XRL 30H,A|XRL 30H,#30H|XRL A,#30H|XRL A,30H|XRL A,@R0|XRL A,@R1|XRL A,R0|XRL A,R1|XRL A,R2|XRL A,R3|XRL A,R4|XRL A,R5|XRL A,R6|XRL A,R7",
  "JNZ $|ACALL 0330H|ORL C,20H|JMP @A+DPTR|MOV A,#30H|MOV 30H,#30H|MOV @R0,#30H|MOV @R1,#30H|MOV R0,#30H|MOV R1,#30H|MOV R2,#30H|MOV R3,#30H|MOV R4,#30H|MOV R5,#30H|MOV R6,#30H|MOV R7,#30H",
  "SJMP $|AJMP 0430H|ANL C,20H|MOVC A,@A+PC|DIV AB|MOV 30H,31H|MOV 30H,@R0|MOV 30H,@R1|MOV 30H,R0|MOV 30H,R1|MOV 30H,R2|MOV 30H,R3|MOV 30H,R4|MOV 30H,R5|MOV 30H,R6|MOV 30H,R7",
  "MOV DPTR,#0030H|ACALL 0430H|MOV 20H,C|MOVC A,@A+DPTR|SUBB A,#30H|SUBB A,30H|SUBB A,@R0|SUBB A,@R1|SUBB A,R0|SUBB A,R1|SUBB A,R2|SUBB A,R3|SUBB A,R4|SUBB A,R5|SUBB A,R6|SUBB A,R7",
  "ORL C,/20H|AJMP 0530H|MOV C,20H|INC DPTR|MUL AB|RESERVED|MOV @R0,30H|MOV @R1,30H|MOV R0,30H|MOV R1,30H|MOV R2,30H|MOV R3,30H|MOV R4,30H|MOV R5,30H|MOV R6,30H|MOV R7,30H",
  "ANL C,/20H|ACALL 0530H|CPL 20H|CPL C|CJNE A,#30H,$|CJNE A,30H,$|CJNE @R0,#30H,$|CJNE @R1,#30H,$|CJNE R0,#30H,$|CJNE R1,#30H,$|CJNE R2,#30H,$|CJNE R3,#30H,$|CJNE R4,#30H,$|CJNE R5,#30H,$|CJNE R6,#30H,$|CJNE R7,#30H,$",
  "PUSH 30H|AJMP 0630H|CLR 20H|CLR C|SWAP A|XCH A,30H|XCH A,@R0|XCH A,@R1|XCH A,R0|XCH A,R1|XCH A,R2|XCH A,R3|XCH A,R4|XCH A,R5|XCH A,R6|XCH A,R7",
  "POP 30H|ACALL 0630H|SETB 20H|SETB C|DA A|DJNZ 30H,$|XCHD A,@R0|XCHD A,@R1|DJNZ R0,$|DJNZ R1,$|DJNZ R2,$|DJNZ R3,$|DJNZ R4,$|DJNZ R5,$|DJNZ R6,$|DJNZ R7,$",
  "MOVX A,@DPTR|AJMP 0730H|MOVX A,@R0|MOVX A,@R1|CLR A|MOV A,30H|MOV A,@R0|MOV A,@R1|MOV A,R0|MOV A,R1|MOV A,R2|MOV A,R3|MOV A,R4|MOV A,R5|MOV A,R6|MOV A,R7",
  "MOVX @DPTR,A|ACALL 0730H|MOVX @R0,A|MOVX @R1,A|CPL A|MOV 30H,A|MOV @R0,A|MOV @R1,A|MOV R0,A|MOV R1,A|MOV R2,A|MOV R3,A|MOV R4,A|MOV R5,A|MOV R6,A|MOV R7,A",
].flatMap((r) => r.split("|"));
const lengths = [
  "1231121111111111",
  "3231121111111111",
  "3211221111111111",
  "3211221111111111",
  "2223221111111111",
  "2223221111111111",
  "2223221111111111",
  "2221232222222222",
  "2221132222222222",
  "3221221111111111",
  "2221102222222222",
  "2221333333333333",
  "2221121111111111",
  "2221131122222222",
  "1211121111111111",
  "1211121111111111",
].join("");
describe("all standard opcode forms", () => {
  it("covers 255 opcodes and exactly one reserved slot", () => {
    expect(ISA.filter(Boolean)).toHaveLength(255);
    expect(ISA[0xa5]).toBeUndefined();
    expect(matrix).toHaveLength(256);
  });
  matrix.forEach((source, op) => {
    if (op === 0xa5) return;
    it(`${op.toString(16).padStart(2, "0")} ${source}: encode, decode and execute`, () => {
      const a = assemble(source);
      expect(a.errors).toEqual([]);
      expect(a.code[0]).toBe(op);
      expect(a.listing[0].bytes).toHaveLength(+lengths[op]);
      expect(decode(a.code, 0).ins.length).toBe(+lengths[op]);
      const c = new CPU8051();
      c.code.set(a.code);
      c.sp = 0x50;
      c.setR(0, 0x30);
      c.setR(1, 0x31);
      c.a = 0x35;
      c.b = 2;
      expect(() => c.step()).not.toThrow();
    });
  });
  it("rejects reserved A5 at execution", () => {
    const c = new CPU8051();
    c.code[0] = 0xa5;
    expect(() => c.step()).toThrow(/Reserved opcode/);
  });
});
describe("assembler", () => {
  it("allows a space character immediate", () => {
    expect(assemble("MOV A,#' '").listing[0].bytes).toEqual([0x74, 32]);
  });
  it("emits Experiment 01 exact bytes and deterministic JMP alias", () => {
    const a = assemble(examples["Experiment 01 · First light"]);
    expect(a.errors).toEqual([]);
    expect([...a.code.slice(0x2000, 0x2007)]).toEqual([
      0x74, 0xf7, 0xf5, 0x90, 2, 0x80, 0x28,
    ]);
    expect(a.listing[2].instruction).toBe("LJMP 8028H");
  });
  it("emits Experiment 02 exact bytes", () => {
    const a = assemble(examples["Experiment 02 · DIP to LED"]);
    expect(a.errors).toEqual([]);
    expect([...a.code.slice(0, 3)]).toEqual([2, 0, 0x30]);
    expect([...a.code.slice(0x30, 0x3d)]).toEqual([
      0x75, 0xd0, 0, 0xe5, 0x90, 0xc4, 0x44, 0xf0, 0xf5, 0x90, 2, 0, 0x33,
    ]);
  });
  it("handles forward EQU, labels, expressions, numbers, strings, DS and DW", () => {
    const a = assemble(
      `SIZE EQU ENDVAL+1\nORG 100H\nMOV A,#SIZE\nSJMP LATER\nDB "a;b",0xF7,11110111B,247\nDW 1234H\nDS 3\nLATER: NOP\nENDVAL EQU 4\nEND`,
    );
    expect(a.errors).toEqual([]);
    expect(a.code[0x101]).toBe(5);
    expect([...a.code.slice(0x104, 0x10a)]).toEqual([
      97, 59, 98, 247, 247, 247,
    ]);
    expect([...a.code.slice(0x10a, 0x10c)]).toEqual([0x12, 0x34]);
    expect(a.symbols.LATER).toBe(0x10f);
    expect(a.code[0x103]).toBe(11);
  });
  it("supports typed declarations and absolute CSEG", () => {
    const a = assemble(
      "MYPORT DATA 90H\nMYBIT BIT P1.3\nCSEG AT 20H\nSETB MYBIT\nMOV MYPORT,#1",
    );
    expect(a.errors).toEqual([]);
    expect([...a.code.slice(32, 37)]).toEqual([0xd2, 0x93, 0x75, 0x90, 1]);
  });
  it("encodes MOV direct,direct source before destination", () => {
    expect(assemble("MOV 30H,31H").listing[0].bytes).toEqual([
      0x85, 0x31, 0x30,
    ]);
  });
  it("resolves bit-addressable RAM and SFR", () => {
    expect(expression("20H.7", {})).toBe(7);
    expect(expression("P1.3", { P1: 0x90 })).toBe(0x93);
    expect(() => expression("30H.0", {})).toThrow(/bit-addressable/);
  });
  it.each([
    "MOV A,R8",
    "MOV DPTR,A",
    "MOV A,#256",
    "MOV 300,A",
    "SJMP missing",
    "ORG 10000H",
    "ORG 0FFFFH\nMOV A,#1",
    "SJMP FAR\nDS 128\nFAR: NOP",
    "AJMP 800H",
    "DB 256",
    "BOGUS A",
    "MOV A,#1 garbage",
    "ORG 0\nDB 1\nORG 0\nDB 2",
    "X EQU X+1",
    "ORL: A,#0F0H",
  ])("reports invalid source: %s", (source) => {
    expect(assemble(source).errors.length).toBeGreaterThan(0);
  });
  it("supports relative offsets at page wrap", () => {
    const a = assemble("ORG 0FFFEH\nSJMP 0");
    expect(a.errors).toEqual([]);
    expect(a.code[65535]).toBe(0);
  });
  it("has no errors in any editable example", () => {
    for (const [name, source] of Object.entries(examples))
      expect(assemble(source).errors, name).toEqual([]);
  });
});
describe("CPU instruction semantics", () => {
  it("PUSH SP reads the incremented pointer; POP SP loads after decrement", () => {
    const c = run("MOV SP,#30H\nPUSH SP\nPOP SP", 3);
    expect(c.ram[0x31]).toBe(0x31);
    expect(c.sp).toBe(0x31);
  });
  it("executes an independent loop and edited source", () => {
    for (const count of [5, 9]) {
      const c = run(
        `MOV A,#0\nMOV R0,#${count}\nLOOP: INC A\nDJNZ R0,LOOP\nSTOP: SJMP STOP`,
        2 + count * 2 + 3,
      );
      expect(c.a).toBe(count);
      expect(c.getR(0)).toBe(0);
      expect(c.pc).toBe(7);
    }
  });
  it("keeps banks, indirect RAM, direct SFR and XDATA separate", () => {
    const c = run(
      "MOV R0,#1\nMOV PSW,#08H\nMOV R0,#30H\nMOV @R0,#77H\nMOV 90H,#55H\nMOV DPTR,#30H\nMOV A,#88H\nMOVX @DPTR,A",
      8,
    );
    expect(c.ram[0]).toBe(1);
    expect(c.ram[8]).toBe(0x30);
    expect(c.ram[0x30]).toBe(0x77);
    expect(c.read(0x90, true)).toBe(0x55);
    expect(c.xdata[0x30]).toBe(0x88);
    expect(c.code[0x30]).toBe(0);
  });
  it("handles nested calls, return addresses and push/pop", () => {
    const c = run(
      "MOV SP,#50H\nMOV A,#12H\nLCALL ONE\nSJMP $\nONE: PUSH ACC\nLCALL TWO\nPOP B\nRET\nTWO: INC A\nRET",
      10,
    );
    expect(c.a).toBe(0x13);
    expect(c.b).toBe(0x12);
    expect(c.sp).toBe(0x50);
    expect(c.pc).toBe(8);
  });
  it("executes all arithmetic boundaries with independent signed/unsigned oracles", () => {
    const values = [0, 1, 7, 15, 16, 63, 127, 128, 129, 240, 254, 255];
    const signed = (v: number) => (v > 127 ? v - 256 : v);
    for (const op of [0x24, 0x34, 0x94])
      for (const a of values)
        for (const b of values)
          for (const cy of [0, 1]) {
            const c = new CPU8051();
            c.code.set([op, b]);
            c.a = a;
            c.carry = cy;
            const carry = op === 0x24 ? 0 : cy,
              sub = op === 0x94,
              v = sub ? a - b - carry : a + b + carry,
              s = sub
                ? signed(a) - signed(b) - carry
                : signed(a) + signed(b) + carry;
            c.step();
            expect(c.a).toBe(v & 255);
            expect(c.carry).toBe(sub ? +(v < 0) : +(v > 255));
            expect((c.psw >> 6) & 1).toBe(
              sub
                ? +((a & 15) - (b & 15) - carry < 0)
                : +((a & 15) + (b & 15) + carry > 15),
            );
            expect((c.psw >> 2) & 1).toBe(+(s < -128 || s > 127));
            expect(c.psw & 1).toBe(
              (c.a.toString(2).match(/1/g)?.length ?? 0) % 2,
            );
          }
  });
  it("DA converts all two-digit packed BCD additions", () => {
    const bcd = (n: number) => Math.floor(n / 10) * 16 + (n % 10);
    const c = new CPU8051();
    c.code.set([0x24, 0, 0xd4]);
    for (let a = 0; a < 100; a++)
      for (let b = 0; b < 100; b++) {
        c.pc = 0;
        c.a = bcd(a);
        c.psw = 0;
        c.code[1] = bcd(b);
        c.step();
        c.step();
        expect(c.a).toBe(bcd((a + b) % 100));
        expect(c.carry).toBe(+(a + b > 99));
      }
  });
  it("MUL and DIV set flags and results", () => {
    const c = run("MOV A,#80H\nMOV B,#3\nMUL AB", 3);
    expect([c.a, c.b, c.carry, c.psw & 4]).toEqual([128, 1, 0, 4]);
    c.code.set([0x84], c.pc);
    c.b = 3;
    c.step();
    expect([c.a, c.b, c.psw & 4]).toEqual([42, 2, 0]);
    c.code[c.pc] = 0x84;
    c.b = 0;
    c.step();
    expect(c.psw & 4).toBe(4);
    expect(c.carry).toBe(0);
  });
  it("INC/DEC preserve carry and wrap, including DPTR", () => {
    const c = run(
      "SETB C\nMOV A,#0FFH\nINC A\nDEC A\nMOV DPTR,#0FFFFH\nINC DPTR",
      6,
    );
    expect([c.a, c.carry, c.dptr]).toEqual([255, 1, 0]);
  });
  it("rotates and exchanges nibbles", () => {
    const c = run("MOV A,#81H\nRL A\nRR A\nSETB C\nRLC A\nRRC A\nSWAP A", 7);
    expect(c.a).toBe(0x18);
    expect(c.carry).toBe(1);
    const d = run(
      "MOV R0,#30H\nMOV @R0,#0A5H\nMOV A,#3CH\nXCHD A,@R0\nXCH A,@R0",
      5,
    );
    expect(d.a).toBe(0xac);
    expect(d.ram[0x30]).toBe(0x35);
  });
  it("logical and Boolean operations update destination", () => {
    const c = run(
      "MOV A,#55H\nANL A,#0FH\nORL A,#80H\nXRL A,#0FFH\nSETB 20H\nMOV C,20H\nANL C,/20H\nORL C,20H\nMOV 21H,C\nCPL 20H\nCLR 21H",
      11,
    );
    expect(c.a).toBe(0x7a);
    expect(c.bitRead(0x20)).toBe(0);
    expect(c.bitRead(0x21)).toBe(0);
    expect(c.carry).toBe(1);
  });
  it("CJNE sets CY independently of branch equality", () => {
    const c = run("MOV A,#3\nCJNE A,#5,TARGET\nMOV A,#0\nTARGET: INC A", 3);
    expect(c.a).toBe(4);
    expect(c.carry).toBe(1);
  });
  it("MOVC uses post-instruction PC and DPTR separately", () => {
    const c = run("MOV A,#1\nMOVC A,@A+PC\nNOP\nDB 77H", 2);
    expect(c.a).toBe(0x77);
    const d = run(
      "MOV DPTR,#TABLE\nMOV A,#2\nMOVC A,@A+DPTR\nSJMP $\nTABLE: DB 1,2,3",
      3,
    );
    expect(d.a).toBe(3);
  });
  it("MOVX @Ri uses P2 latch for the high byte", () => {
    const c = run(
      "MOV P2,#12H\nMOV R0,#34H\nMOV A,#0ABH\nMOVX @R0,A\nCLR A\nMOVX A,@R0",
      6,
    );
    expect(c.xdata[0x1234]).toBe(0xab);
    expect(c.a).toBe(0xab);
  });
  it("port reads use pins; read-modify-write uses latch", () => {
    const c = program(
      "MOV A,P1\nANL P1,#0FEH\nMOV C,P1.4\nCPL P1.4\nSETB P1.4",
    );
    c.externalLow[1] = 0x10;
    c.step();
    expect(c.a).toBe(0xef);
    c.step();
    expect(c.read(0x90, true)).toBe(0xfe);
    c.step();
    expect(c.carry).toBe(0);
    c.step();
    expect(c.read(0x90, true)).toBe(0xee);
    c.step();
    expect(c.read(0x90, true)).toBe(0xfe);
    expect(c.pins(1)).toBe(0xee);
  });
  it("Port 0 is open-drain with optional external pullups", () => {
    const c = new CPU8051();
    expect(c.pins(0)).toBe(0);
    c.pullups[0] = 255;
    expect(c.pins(0)).toBe(255);
    c.write(0x80, 0xf7);
    expect(c.pins(0)).toBe(0xf7);
  });
});
describe("timers, interrupts and UART", () => {
  it("defers pending interrupts through writes to IE and RETI", () => {
    const c = program("MOV IE,#82H\nNOP");
    c.bitWrite(0x8d, 1);
    c.step();
    expect(c.pc).toBe(3);
    c.step();
    expect(c.pc).toBe(11);
    c.code[11] = 0x32;
    c.bitWrite(0x8d, 1);
    c.step();
    expect(c.pc).toBe(4);
    c.step();
    expect(c.pc).toBe(11);
  });
  it.each([0, 1, 2])("timer mode %s overflows and sets TF0", (mode) => {
    const c = new CPU8051();
    c.write(0x89, mode);
    c.write(0x8c, 255);
    c.write(0x8a, mode === 0 ? 31 : 255);
    c.bitWrite(0x8c, 1);
    c.advance(1);
    expect(c.bitRead(0x8d)).toBe(1);
    expect(c.read(0x8a)).toBe(mode === 2 ? 255 : 0);
  });
  it("mode 3 splits TL0 and TH0", () => {
    const c = new CPU8051();
    c.write(0x89, 3);
    c.write(0x8a, 255);
    c.write(0x8c, 255);
    c.bitWrite(0x8c, 1);
    c.bitWrite(0x8e, 1);
    c.advance(1);
    expect(c.read(0x8a)).toBe(0);
    expect(c.read(0x8c)).toBe(0);
    expect(c.read(0x88) & 0xa0).toBe(0xa0);
  });
  it("counter increments only for external pulses and respects gate", () => {
    const c = new CPU8051();
    c.write(0x89, 5);
    c.bitWrite(0x8c, 1);
    c.advance(100);
    expect(c.read(0x8a)).toBe(0);
    c.pulseCounter(0);
    c.advance(1);
    expect(c.read(0x8a)).toBe(1);
    c.write(0x89, 0x0d);
    c.setInterruptPin(0, true);
    c.pulseCounter(0);
    c.advance(1);
    expect(c.read(0x8a)).toBe(1);
  });
  it("timer cycles reflect multi-cycle instructions", () => {
    const c = program("LCALL TARGET\nTARGET: MUL AB");
    c.bitWrite(0x8c, 1);
    c.write(0x89, 1);
    c.step();
    c.step();
    expect(c.cycles).toBe(6);
    expect(c.read(0x8a)).toBe(6);
  });
  it("INT0 vectors, stacks return address, and RETI restores it", () => {
    const c = new CPU8051();
    c.sp = 0x50;
    c.code[0] = 0;
    c.code[3] = 0x32;
    c.write(0xa8, 0x81);
    c.bitWrite(0x88, 1);
    c.setInterruptPin(0, true);
    c.step();
    expect(c.pc).toBe(3);
    expect(c.sp).toBe(0x52);
    expect(c.ram[0x51]).toBe(1);
    expect(c.bitRead(0x89)).toBe(0);
    c.step();
    expect(c.pc).toBe(1);
    expect(c.sp).toBe(0x50);
  });
  it("high-priority interrupt preempts low, equal priority cannot nest", () => {
    const c = new CPU8051();
    c.code[3] = 0;
    c.code[11] = 0x32;
    c.write(0xa8, 0x83);
    c.write(0xb8, 2);
    c.bitWrite(0x88, 1);
    c.setInterruptPin(0, true);
    c.step();
    expect(c.pc).toBe(3);
    c.bitWrite(0x8d, 1);
    c.step();
    expect(c.pc).toBe(11);
    expect(c.sp).toBe(11);
    c.step();
    expect(c.pc).toBe(4);
    expect(c.sp).toBe(9);
  });
  it("UART mode 1 transmits after timer 1 baud ticks", () => {
    const c = program(examples["Serial · transmit U"]);
    let output = "";
    c.onSerial = (v) => (output += String.fromCharCode(v));
    for (let i = 0; i < 600; i++) c.step();
    expect(output).toBe("U");
    expect(c.cycles).toBeGreaterThan(900);
  });
  it("UART receive is separate from TX SBUF and requires REN", () => {
    const c = new CPU8051();
    expect(() => c.receive(65)).toThrow(/REN/);
    c.write(0x98, 0x50);
    c.write(0x99, 90);
    c.receive(65);
    expect(c.read(0x99)).toBe(65);
    expect(c.read(0x99, true)).toBe(90);
    expect(c.bitRead(0x98)).toBe(1);
  });
});
describe("trainer experiments and file formats", () => {
  it("debugger peeks do not acknowledge keyboard data", () => {
    const t = new Trainer();
    t.key("5");
    expect(t.cpu.peekX(0xc004)).toBe(5);
    expect(t.keyFlag).toBe(1);
    expect(t.cpu.readX(0xc004)).toBe(5);
    expect(t.keyFlag).toBe(0);
  });
  it("runs SDCC 4.4.0 compiled firmware including startup without internal assembly", () => {
    const t = new Trainer();
    t.monitorInit = false;
    t.load(parseHex(externalHex));
    for (let i = 0; i < 2000; i++) t.step();
    expect(t.cpu.ram[0x30]).toBe(5);
    expect(t.cpu.read(0x90, true)).toBe(0xf7);
    expect(t.cpu.pc).toBe(0x75);
    expect(t.leds()[4]).toBe(true);
  });
  it("virtual serial monitor edits memory and executes CODE", () => {
    const t = new Trainer();
    t.command("SPACE CODE");
    t.command("AD 2000");
    t.command("DA 74");
    t.command("+");
    t.command("DA 55");
    expect(t.command("READ 2000")).toContain("74");
    t.command("GO 2000");
    t.command("STP");
    expect(t.cpu.a).toBe(0x55);
    expect(t.command("REGS")).toContain("A=55");
    expect(() => t.command("BOGUS")).toThrow(/Unknown/);
  });
  it("Experiment 01 runs to monitor with derived registers and LED 5", () => {
    const t = new Trainer();
    t.load(assemble(examples["Experiment 01 · First light"]));
    for (let i = 0; i < 3; i++) t.step();
    expect([t.cpu.a, t.cpu.b, t.cpu.psw, t.cpu.sp, t.cpu.dptr]).toEqual([
      0xf7, 0, 1, 0x50, 0,
    ]);
    expect(t.cpu.read(0x90, true)).toBe(0xf7);
    expect(t.leds()).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(t.returned).toBe(true);
    expect(t.cpu.cycles).toBe(4);
    expect(t.lcd()).toEqual(
      ["A=F7 B=00 PSW=01", "SP=50 DPTR=0000"].map((line) => line.padEnd(16)),
    );
  });
  it("Experiment 02 responds to every DIP combination through P1 pins", () => {
    for (let mask = 0; mask < 16; mask++) {
      const t = new Trainer();
      t.load(assemble(examples["Experiment 02 · DIP to LED"]));
      t.dips = t.dips.map((_, i) => !!(mask & (1 << i)));
      t.resolve();
      for (let i = 0; i < 7; i++) t.step();
      const expected = 0xf0 | (~mask & 15);
      expect(t.cpu.read(0x90, true)).toBe(expected);
      expect(t.cpu.pins(1)).toBe(expected & ~(mask << 4));
      expect(t.leds()[4]).toBe(!!(mask & 8));
      t.dips.fill(false);
      t.resolve();
      for (let i = 0; i < 5; i++) t.step();
      expect(t.cpu.read(0x90, true)).toBe(255);
    }
  });
  it("keypad examines and modifies RAM, XDATA and CODE", () => {
    const t = new Trainer();
    for (const space of ["IRAM", "XDATA", "CODE"] as const) {
      t.space = space;
      t.key("AD");
      for (const k of "0030") t.key(k);
      t.key("DA");
      t.key("A");
      t.key("5");
      expect(t.memoryRead()).toBe(0xa5);
      t.key("+");
      expect(t.address).toBe(0x31);
      t.key("-");
      expect(t.address).toBe(0x30);
    }
    t.space = "IRAM";
    t.address = 128;
    expect(() => t.memoryWrite(1)).toThrow(/RAM/);
  });
  it("manual bytes execute identically and standard reset differs from monitor reset", () => {
    const t = new Trainer();
    t.load(
      binaryImage(
        new Uint8Array([0x74, 0xf7, 0xf5, 0x90, 2, 0x80, 0x28]),
        0x2000,
      ),
    );
    t.key("GO");
    t.key("STP");
    t.key("STP");
    t.key("STP");
    expect(t.returned).toBe(true);
    expect(t.cpu.a).toBe(0xf7);
    t.hardwareReset();
    expect(t.cpu.sp).toBe(7);
    expect(t.cpu.pc).toBe(0);
  });
  it("virtual LCD requires opt-in and unavailable hardware faults explicitly", () => {
    const t = new Trainer();
    expect(() => t.cpu.writeX(0xc008, 1)).toThrow(/unverified/);
    t.virtualLCD = true;
    t.load(assemble(examples["LCD · virtual bus demo"]));
    for (let i = 0; i < 8; i++) t.step();
    expect(t.lcd()[0].startsWith("Hi")).toBe(true);
    expect(() => t.cpu.readX(0xc018)).toThrow(/unavailable/);
  });
  it("Intel HEX roundtrips sparse addresses and entry, and BIN keeps origin", () => {
    const a = assemble("ORG 2000H\nMOV A,#0F7H\nORG 3000H\nDB 55H");
    const parsed = parseHex(exportHex(a));
    expect(parsed.code).toEqual(a.code);
    expect(parsed.used).toEqual(a.used);
    expect(parsed.entry).toBe(0x2000);
    const bin = exportBinary(a);
    expect(bin.address).toBe(0x2000);
    expect(bin.bytes[0]).toBe(0x74);
    expect(bin.bytes.at(-1)).toBe(0x55);
  });
  it.each([
    ":02000000740584\n:00000001FF",
    ":02000000740585",
    ":0200000074AA85\n:00000001FF",
    ":020000040001F9\n:0100000000FF\n:00000001FF",
  ])("rejects corrupt, truncated or oversized HEX", (text) => {
    expect(() => parseHex(text)).toThrow();
  });
  it("executes independently hand-encoded HEX without assembler", () => {
    const image = parseHex(":090000007400780504D8FD80FEAF\n:00000001FF");
    const c = new CPU8051();
    c.code.set(image.code);
    for (let i = 0; i < 20; i++) c.step();
    expect(c.a).toBe(5);
    expect(c.getR(0)).toBe(0);
    expect(c.pc).toBe(7);
  });
});
