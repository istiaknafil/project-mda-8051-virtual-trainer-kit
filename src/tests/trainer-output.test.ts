import { describe, expect, it } from "vitest";
import { assemble } from "../assembler";
import { Trainer } from "../board/trainer";
import { examples } from "../experiments/examples";
import { binaryImage } from "../editor/formats";

const off = Array(8).fill(false);
const outputFor = (value: number) =>
  [7, 6, 5, 4, 3, 2, 1, 0].map((pin) => !(value & (1 << pin)));

describe("program-driven trainer LEDs", () => {
  it("all DIP combinations affect input pins but cannot light LEDs without a program", () => {
    const t = new Trainer();
    for (let mask = 0; mask < 16; mask++) {
      t.dips = t.dips.map((_, i) => !!(mask & (1 << i)));
      t.resolve();
      expect(t.cpu.pins(1)).toBe(255 & ~(mask << 4));
      expect(t.leds()).toEqual(off);
    }
    expect(() => t.step()).toThrow(/Assemble/);
    expect(() => t.key("GO")).toThrow(/Assemble/);
    expect(() => t.command("GO 2000")).toThrow(/Assemble/);
    expect(() => t.key("STP")).toThrow(/Assemble/);
    expect(t.cpu.instructions).toBe(0);
  });

  it("successful assembly alone and instructions that only read P1 leave LEDs off", () => {
    const t = new Trainer();
    t.dips.fill(true);
    t.resolve();
    t.load(assemble("MOV A,P1\nSWAP A\nORL A,#0F0H\nSJMP $"));
    expect(t.leds()).toEqual(off);
    for (let i = 0; i < 20; i++) t.step();
    expect(t.cpu.a).toBe(0xf0);
    expect(t.cpu.read(0x90, true)).toBe(0xff);
    expect(t.leds()).toEqual(off);
  });

  it("the supplied loop updates LEDs only when MOV P1,A executes", () => {
    const t = new Trainer();
    t.dips[0] = true;
    t.resolve();
    t.load(assemble(examples["Experiment 02 · DIP to LED"]));
    for (let i = 0; i < 5; i++) {
      t.step();
      expect(t.leds()).toEqual(off);
    }
    t.step();
    expect(t.leds()).toEqual(outputFor(0xfe));
    expect(t.cpu.pins(1)).toBe(0xee);
    t.dips[0] = false;
    t.dips[1] = true;
    t.resolve();
    expect(t.leds()).toEqual(outputFor(0xfe));
    for (let i = 0; i < 5; i++) t.step();
    expect(t.leds()).toEqual(outputFor(0xfd));
  });

  it.each([
    ["MOV A,P1\nMOV P1,A", 0x6f, 2],
    ["MOV A,P1\nSWAP A\nORL A,#0F0H\nMOV P1,A", 0xf6, 4],
    ["MOV A,P1\nSWAP A\nORL A,#0CH\nMOV P1,A", 0xfe, 4],
    ["MOV A,P1\nXRL A,#0FFH\nMOV P1,A", 0x90, 3],
    ["MOV P1,#0AAH", 0xaa, 1],
    ["CLR P1.3", 0xf7, 1],
    ["MOV R2,#55H\nMOV P1,R2", 0x55, 2],
  ])("arbitrary program variant executes: %s", (source, expected, steps) => {
    const t = new Trainer();
    t.dips = [true, false, false, true];
    t.resolve();
    const image = assemble(source as string);
    expect(image.errors).toEqual([]);
    t.load(image);
    expect(t.leds()).toEqual(off);
    for (let i = 0; i < (steps as number); i++) t.step();
    expect(t.cpu.read(0x90, true)).toBe(expected);
    expect(t.leds()).toEqual(outputFor(expected as number));
  });

  it("editing source invalidates a prior successful program and clears output", () => {
    const t = new Trainer();
    t.load(assemble("MOV P1,#0\nSJMP $"));
    t.step();
    expect(t.leds()).toEqual(Array(8).fill(true));
    t.invalidateProgram();
    expect(t.programReady).toBe(false);
    expect(t.leds()).toEqual(off);
    expect(() => t.step()).toThrow(/Assemble/);
    t.reset();
    expect(() => t.step()).toThrow(/Assemble/);
    t.load(assemble("MOV P1,#0FFH\nSJMP $"));
    t.step();
    expect(t.leds()).toEqual(off);
  });

  it("the ORL colon typo cannot execute a previous image", () => {
    const t = new Trainer();
    t.load(assemble("MOV P1,#0"));
    t.step();
    const bad = assemble("MOV A,P1\nSWAP A\nORL: A,#0F0H\nMOV P1,A");
    expect(bad.errors[0].message).toContain("Use ORL A,#0F0H");
    expect(() => t.load(bad)).toThrow(/Assembly failed/);
    expect(t.leds()).toEqual(off);
    expect(() => t.step()).toThrow(/Assemble/);
  });

  it("loading raw machine code uses the same execution and LED path", () => {
    const t = new Trainer();
    t.dips.fill(true);
    t.resolve();
    t.load(binaryImage(new Uint8Array([0x75, 0x90, 0xf7]), 0x2000));
    expect(t.leds()).toEqual(off);
    t.step();
    expect(t.leds()).toEqual(outputFor(0xf7));
    t.hardwareReset();
    expect(t.leds()).toEqual(off);
  });

  it("same-value port writes count, while debugger writes alone do not enable LEDs", () => {
    const t = new Trainer();
    t.configure({ ...t.wiring, activeLow: false });
    t.load(assemble("MOV P1,#0FFH"));
    t.cpu.write(0x90, 255);
    expect(t.leds()).toEqual(off);
    t.step();
    expect(t.leds()).toEqual(Array(8).fill(true));
  });
});
