import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BoardFit } from "./BoardFit";
import { LayoutControls, useLayout } from "./LayoutControls";
import { assemble, listingText, type Assembly } from "../assembler";
import { Trainer, memoryMap } from "../board/trainer";
import { decode, hex, SFR } from "../core/isa";
import { examples, lessons } from "../experiments/examples";
import { SourceEditor } from "../editor/SourceEditor";
import {
  parseHex,
  exportHex,
  exportBinary,
  binaryImage,
} from "../editor/formats";
import type { Trace } from "../cpu8051/cpu";
type SourceTab = {
  id: string;
  name: string;
  source: string;
  breakpoints: number[];
};
const initial = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("mda8051.sources") ?? "null");
    if (
      Array.isArray(saved) &&
      saved.length &&
      saved.every(
        (t) =>
          typeof t.id === "string" &&
          typeof t.name === "string" &&
          typeof t.source === "string" &&
          Array.isArray(t.breakpoints),
      )
    )
      return saved as SourceTab[];
  } catch {}
  return [
    {
      id: "first",
      name: "experiment-01.asm",
      source: Object.values(examples)[0],
      breakpoints: [],
    },
  ];
};
const download = (name: string, data: string | Uint8Array) => {
  const blob = new Blob([data as BlobPart], {
      type:
        typeof data === "string" ? "text/plain" : "application/octet-stream",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
};
const number = (s: string, max = 65535) => {
  if (!/^(?:0x)?[\da-f]+h?$/i.test(s.trim()))
    throw new Error("Enter a hexadecimal value");
  const n = parseInt(s.trim().replace(/^0x/i, "").replace(/h$/i, ""), 16);
  if (n > max) throw new Error(`Value must be 0–${hex(max)}H`);
  return n;
};
export function App() {
  const view = useLayout();
  const [trainer] = useState(() => new Trainer()),
    [tabs, setTabs] = useState<SourceTab[]>(initial),
    [active, setActive] = useState(() => tabs[0].id),
    [, render] = useState(0),
    [running, setRunning] = useState(false),
    [speed, setSpeed] = useState(400),
    [assembly, setAssembly] = useState<Assembly | null>(null),
    [assembledSource, setAssembledSource] = useState(""),
    [assembledTab, setAssembledTab] = useState(""),
    [diagnostics, setDiagnostics] = useState<string[]>([
      "Ready. Assemble a source file or import machine code. Board wiring is provisional; manuals not supplied.",
    ]),
    [section, setSection] = useState("listing"),
    [memorySpace, setMemorySpace] = useState("IRAM"),
    [memoryBase, setMemoryBase] = useState("00"),
    [lesson, setLesson] = useState(0),
    [done, setDone] = useState<number[]>([]),
    [selectedTrace, setSelectedTrace] = useState<Trace | null>(null),
    [serialInput, setSerialInput] = useState(""),
    [raw, setRaw] = useState("74 F7 F5 90 02 80 28"),
    [rawAddress, setRawAddress] = useState("2000"),
    [wireText, setWireText] = useState(JSON.stringify(trainer.wiring, null, 2)),
    [watches, setWatches] = useState<string[]>(["A", "PC", "P1", "PSW"]),
    [watchInput, setWatchInput] = useState("30");
  const file = useRef<HTMLInputElement>(null),
    speedRef = useRef(speed),
    runningRef = useRef(false),
    lastBreakpoint = useRef<number | null>(null),
    skipBreakpoint = useRef(false);
  speedRef.current = speed;
  const tab = tabs.find((t) => t.id === active) ?? tabs[0],
    cpu = trainer.cpu;
  const fresh =
    assembly && assembledTab === active && assembledSource === tab.source;
  const update = () => render((n) => n + 1);
  const note = (message: string) =>
    setDiagnostics((d) => [message, ...d].slice(0, 80));
  const pause = () => {
    runningRef.current = false;
    trainer.stopped = true;
    setRunning(false);
  };
  const safe = (fn: () => void) => {
    try {
      fn();
      update();
    } catch (e) {
      pause();
      note((e as Error).message);
    }
  };
  const start = () => {
    trainer.requireProgram();
    skipBreakpoint.current = lastBreakpoint.current === cpu.pc;
    lastBreakpoint.current = null;
    trainer.returned = false;
    trainer.stopped = false;
    runningRef.current = true;
    setRunning(true);
  };
  const addSource = (name: string, source: string) => {
    invalidateSource();
    const id = crypto.randomUUID();
    setTabs((t) => [...t, { id, name, source, breakpoints: [] }]);
    setActive(id);
  };
  const invalidateSource = () => {
    pause();
    trainer.invalidateProgram();
    setSelectedTrace(null);
    lastBreakpoint.current = null;
  };
  const selectSource = (id: string) => {
    if (id !== active) invalidateSource();
    setActive(id);
  };
  const changeSource = (source: string) => {
    if (source === tab.source) return;
    invalidateSource();
    setTabs((t) => t.map((s) => (s.id === active ? { ...s, source } : s)));
  };
  const toggleBreakpoint = (line: number) =>
    setTabs((t) =>
      t.map((s) =>
        s.id === active
          ? {
              ...s,
              breakpoints: s.breakpoints.includes(line)
                ? s.breakpoints.filter((n) => n !== line)
                : [...s.breakpoints, line],
            }
          : s,
      ),
    );
  const build = () => {
    invalidateSource();
    const result = assemble(tab.source);
    setAssembly(result);
    setAssembledSource(tab.source);
    setAssembledTab(active);
    setSelectedTrace(null);
    if (result.errors.length) {
      note(result.errors.map((e) => `Line ${e.line}: ${e.message}`).join("\n"));
      return false;
    }
    trainer.load(result);
    note(
      `Assembled ${result.used.reduce((a, b) => a + b, 0)} bytes. Entry ${hex(result.entry, 4)}H. JMP labels use LJMP.`,
    );
    update();
    return true;
  };
  const step = () =>
    safe(() => {
      pause();
      trainer.requireProgram();
      setSelectedTrace(null);
      trainer.step();
    });
  const stepLine = () =>
    safe(() => {
      pause();
      trainer.requireProgram();
      const line = fresh
        ? assembly.listing.find((l) => l.address === cpu.pc)?.line
        : undefined;
      let count = 0;
      do {
        trainer.step();
        count++;
      } while (
        count < 1000 &&
        !trainer.returned &&
        line !== undefined &&
        assembly?.listing.find((l) => l.address === cpu.pc)?.line === line
      );
      setSelectedTrace(null);
    });
  useEffect(() => {
    try {
      localStorage.setItem("mda8051.sources", JSON.stringify(tabs));
    } catch {
      note(
        "Browser storage is full or disabled. Use Save or Export Project to preserve your work.",
      );
    }
  }, [tabs]);
  useEffect(() => {
    if (!running) return;
    let credit = 0;
    const timer = setInterval(() => {
      if (!runningRef.current) return;
      credit += speedRef.current / 40;
      const count = Math.floor(credit);
      credit -= count;
      try {
        const bps = new Set(
          fresh
            ? assembly.listing
                .filter((l) => tab.breakpoints.includes(l.line))
                .map((l) => l.address)
            : [],
        );
        for (let i = 0; i < count; i++) {
          if (bps.has(cpu.pc) && !skipBreakpoint.current) {
            lastBreakpoint.current = cpu.pc;
            pause();
            note(`Breakpoint at ${hex(cpu.pc, 4)}H`);
            break;
          }
          skipBreakpoint.current = false;
          trainer.step();
          if (trainer.returned) {
            pause();
            note("Returned to virtual monitor at 8028H.");
            break;
          }
        }
        setSelectedTrace(null);
        update();
      } catch (e) {
        pause();
        note((e as Error).message);
        update();
      }
    }, 25);
    return () => clearInterval(timer);
  }, [running, tab.breakpoints, fresh, assembly]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F7") {
        e.preventDefault();
        step();
      }
      if (e.key === "F5") {
        e.preventDefault();
        running
          ? pause()
          : safe(() => {
              start();
            });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        download(tab.name, tab.source);
      }
      if (e.key === "F9") {
        e.preventDefault();
        build();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const importFile = async (f: File) => {
    pause();
    try {
      const ext = f.name.split(".").pop()?.toLowerCase();
      if (["asm", "a51", "src", "lst"].includes(ext ?? "")) {
        addSource(f.name, await f.text());
        note(
          ext === "lst"
            ? "Listing opened for reference; it is not executable source."
            : "Source opened. Assemble to load the CPU.",
        );
      } else if (ext === "hex" || ext === "ihx") {
        trainer.load(parseHex(await f.text()));
        setAssembly(null);
        note(`Loaded ${f.name}; addresses and checksums validated.`);
      } else if (ext === "bin") {
        const address = prompt("Binary load address (hexadecimal)", "0000");
        if (address === null) return;
        trainer.load(
          binaryImage(new Uint8Array(await f.arrayBuffer()), number(address)),
        );
        setAssembly(null);
        note(`Loaded binary at ${address}H.`);
      } else if (ext === "json") {
        const p = JSON.parse(await f.text());
        if (
          p.format !== "mda8051-project-v1" ||
          !Array.isArray(p.tabs) ||
          !p.tabs.length ||
          p.tabs.some(
            (t: SourceTab) =>
              typeof t.source !== "string" ||
              typeof t.name !== "string" ||
              typeof t.id !== "string" ||
              !Array.isArray(t.breakpoints),
          )
        )
          throw new Error("Invalid project file");
        trainer.configure(p.wiring);
        setTabs(p.tabs);
        setActive(p.tabs[0].id);
        setWireText(JSON.stringify(p.wiring, null, 2));
        trainer.load(parseHex(p.hex));
        trainer.monitorInit = !!p.monitorInit;
        trainer.monitorHook = !!p.monitorHook;
        trainer.reset();
        setAssembly(null);
        note(
          "Project restored. Assemble a source tab to restore source-level debugging.",
        );
      } else
        throw new Error(
          "Supported: ASM, A51, SRC, LST, HEX, IHX, BIN, project JSON",
        );
      update();
    } catch (e) {
      note((e as Error).message);
    }
  };
  const saveAs = () => {
    const name = prompt("Save source as", tab.name);
    if (name) {
      setTabs((t) => t.map((s) => (s.id === active ? { ...s, name } : s)));
      download(name, tab.source);
    }
  };
  const image = () => ({
    code: cpu.code,
    used: trainer.used,
    entry: trainer.entry,
  });
  const exportProject = () =>
    download(
      "mda8051-project.json",
      JSON.stringify(
        {
          format: "mda8051-project-v1",
          tabs,
          wiring: trainer.wiring,
          monitorInit: trainer.monitorInit,
          monitorHook: trainer.monitorHook,
          hex: exportHex(image()),
        },
        null,
        2,
      ),
    );
  const trace = selectedTrace ?? trainer.history.at(-1),
    current = fresh
      ? (assembly.listing.find((l) => l.address === cpu.pc)?.line ?? 0)
      : 0;
  let next = "";
  try {
    next = decode(cpu.code, cpu.pc).text;
  } catch (e) {
    next = (e as Error).message;
  }
  let base = 0;
  try {
    base = number(memoryBase);
  } catch {}
  const memory =
    memorySpace === "IRAM"
      ? cpu.ram
      : memorySpace === "CODE"
        ? cpu.code
        : memorySpace === "SFR"
          ? cpu.sfr
          : cpu.xdata;
  const offset = memorySpace === "SFR" ? 128 : 0;
  const size = memory.length;
  const rows = Array.from({ length: 8 }, (_, r) => base + r * 8);
  const readCell = (a: number) => {
    try {
      return memorySpace === "XDATA" ? cpu.peekX(a) : memory[a - offset];
    } catch {
      return undefined;
    }
  };
  const editCell = (a: number) =>
    safe(() => {
      pause();
      const v = prompt(
        `${memorySpace} ${hex(a, 4)}H (hex)`,
        hex(readCell(a) ?? 0),
      );
      if (v === null) return;
      const n = number(v, 255);
      if (memorySpace === "CODE") {
        trainer.writeCode(a, n);
        setAssembly(null);
      } else if (memorySpace === "XDATA") cpu.writeX(a, n);
      else cpu.write(a, n);
    });
  const stat = (name: string, v: number, width = 2) => (
    <div
      className={`register ${trace && trace.before[name] !== trace.after[name] ? "changed" : ""}`}
      key={name}
      onDoubleClick={() =>
        safe(() => {
          pause();
          const s = prompt(`${name} (hex)`, hex(v, width));
          if (s === null) return;
          const n = number(s, width === 4 ? 65535 : 255);
          if (name === "PC") cpu.pc = n;
          else if (name === "DPTR") cpu.dptr = n;
          else if (/^R\d$/.test(name)) cpu.setR(+name[1], n);
          else cpu.write(name === "A" ? 0xe0 : SFR[name], n);
        })
      }
    >
      <span>{name}</span>
      <b>{hex(v, width)}</b>
    </div>
  );
  return (
    <div
      className="app"
      style={
        {
          "--text-scale": view.layout.zoom / 100,
          "--board-width": `${view.layout.board}%`,
          "--inspector-width": `${view.layout.inspector}%`,
          "--editor-share": view.layout.editor,
          "--listing-share": 100 - view.layout.editor,
          "--desk-height": `${view.layout.desk}px`,
        } as CSSProperties
      }
    >
      <header className="masthead">
        <div className="brand">
          <div className="brand-icon">μ</div>
          <div>
            <h1>
              MDA<span>—</span>8051 <small>VIRTUAL LABORATORY</small>
            </h1>
            <p>Write. Assemble. Observe.</p>
          </div>
        </div>
        <LayoutControls {...view} />
      </header>
      <nav className="toolbar" aria-label="Development controls">
        <div>
          <button
            onClick={() =>
              addSource(
                `untitled-${tabs.length + 1}.asm`,
                "ORG 0000H\n\n; Your program starts here\nNOP\nEND\n",
              )
            }
          >
            ＋ New
          </button>
          <button onClick={() => file.current?.click()}>↥ Open</button>
          <button onClick={() => download(tab.name, tab.source)}>Save</button>
          <button onClick={saveAs}>Save as</button>
        </div>
        <div>
          <button className="assemble" onClick={build}>
            ◇ Assemble <kbd>F9</kbd>
          </button>
          <button
            className="run"
            onClick={() =>
              safe(() => {
                start();
              })
            }
            disabled={running}
          >
            ▶ Run
          </button>
          <button onClick={pause} disabled={!running}>
            Ⅱ Pause
          </button>
          <button
            onClick={() => {
              pause();
              trainer.cpu.pc = trainer.entry;
              trainer.returned = false;
              update();
            }}
          >
            ■ Stop
          </button>
          <button onClick={step}>
            ↦ Step <kbd>F7</kbd>
          </button>
          <button onClick={stepLine}>Step line</button>
          <button
            onClick={() =>
              safe(() => {
                pause();
                trainer.reset();
                setSelectedTrace(null);
              })
            }
          >
            ↻ Reset
          </button>
        </div>
        <details className="export-menu">
          <summary>Export ▾</summary>
          <div>
            <button
              onClick={() => download("firmware.hex", exportHex(image()))}
            >
              Intel HEX
            </button>
            <button
              onClick={() => {
                const bin = exportBinary(image());
                download(`firmware-${hex(bin.address, 4)}.bin`, bin.bytes);
                note(
                  `BIN starts at ${hex(bin.address, 4)}H; load it at that address.`,
                );
              }}
            >
              Binary
            </button>
            <button
              onClick={() =>
                assembly
                  ? download("program.lst", listingText(assembly))
                  : note("Assemble source to generate a source listing.")
              }
            >
              Listing
            </button>
            <button onClick={exportProject}>Project JSON</button>
          </div>
        </details>
        <input
          ref={file}
          type="file"
          hidden
          accept=".asm,.a51,.src,.hex,.ihx,.bin,.lst,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </nav>
      <div className="workspace">
        <aside className="hardware-column">
          <div className="panel-heading">
            <h2>TRAINER BOARD</h2>
            <span className="tag">MDA / EMS51</span>
          </div>
          <BoardFit>
            <div className="pcb">
              <span className="screw tl" />
              <span className="screw tr" />
              <span className="screw bl" />
              <span className="screw br" />
              <div className="pcb-title">
                MDA-8051 <span>EDUCATIONAL SYSTEM</span>
              </div>
              <svg
                className="pcb-traces"
                viewBox="0 0 340 600"
                aria-hidden="true"
              >
                <g fill="none" stroke="#72aa8433" strokeWidth="2">
                  {Array.from({ length: 12 }, (_, i) => (
                    <path
                      key={i}
                      d={`M ${18 + i * 5} 70 V ${230 + i * 6} H ${280 - i * 4} V 550`}
                    />
                  ))}
                </g>
              </svg>
              <div className="board-caption">
                LCD1 · 16 × 2 / VIRTUAL MONITOR
              </div>
              <div className="lcd" aria-label="Trainer LCD">
                {trainer.lcd().map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
              <div className="chip-row">
                <div className="chip">
                  <span>INTEL</span>
                  <strong>{cpu.profile}</strong>
                  <small>MCS-51 · 40 PIN</small>
                </div>
                <div className="crystal">
                  11.0592<small>MHz</small>
                </div>
                <div className="power-led">
                  <i />
                  +5V
                </div>
              </div>
              <div className="board-caption">
                D1–D8 · P1{" "}
                {trainer.wiring.ledSource === "pins" ? "PINS" : "OUTPUT LATCH"}
              </div>
              <div className="board-caption" role="status">
                {trainer.ledStatus}
              </div>
              <div className="led-bank">
                {trainer.leds().map((on, i) => (
                  <div
                    key={i}
                    title={`LED ${i + 1} ↔ P1.${trainer.wiring.ledPins[i]}`}
                  >
                    <i className={on ? "lit" : ""} />
                    <span>{i + 1}</span>
                  </div>
                ))}
              </div>
              <div className="dip-row">
                <div>
                  <div className="board-caption">SW1 · DIP INPUT</div>
                  <div className="dip-bank">
                    {trainer.dips.map((on, i) => (
                      <button
                        key={i}
                        className={on ? "on" : ""}
                        aria-label={`DIP ${i + 1}`}
                        aria-pressed={on}
                        onClick={() => {
                          trainer.dips[i] = !on;
                          trainer.resolve();
                          update();
                        }}
                      >
                        <span />
                        <b>{i + 1}</b>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="dip-legend">
                  ON ↓ GND
                  <br />
                  P1.4–P1.7*
                  <br />
                  <span>*editable wiring</span>
                </div>
              </div>
              <div className="board-caption">MONITOR KEYPAD</div>
              <div className="keypad">
                {[
                  "C",
                  "D",
                  "E",
                  "F",
                  "RES",
                  "8",
                  "9",
                  "A",
                  "B",
                  "AD",
                  "4",
                  "5",
                  "6",
                  "7",
                  "DA",
                  "0",
                  "1",
                  "2",
                  "3",
                  "GO",
                  "+",
                  "-",
                  "INT",
                  "T0",
                  "STP",
                ].map((k) => (
                  <button
                    key={k}
                    className={
                      ["GO", "STP"].includes(k)
                        ? "key-action"
                        : k.length > 1
                          ? "key-function"
                          : ""
                    }
                    onClick={() =>
                      safe(() => {
                        if (k !== "GO") pause();
                        trainer.key(k);
                        if (
                          trainer.space === "CODE" &&
                          trainer.inputMode === "DA" &&
                          /^[0-9A-F]$/.test(k)
                        )
                          setAssembly(null);
                        if (k === "GO") start();
                      })
                    }
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div className="board-footer">
                <span>● PWR</span>
                <span>J6 · CONFIGURABLE</span>
                <span>REV V1</span>
              </div>
            </div>
          </BoardFit>
          <div className="hardware-tools">
            <label>
              Monitor space{" "}
              <select
                value={trainer.space}
                onChange={(e) => {
                  trainer.space = e.target.value as typeof trainer.space;
                  update();
                }}
              >
                <option>CODE</option>
                <option>IRAM</option>
                <option>XDATA</option>
              </select>
            </label>
            <label>
              P1 jumper{" "}
              <select
                value={trainer.mode}
                onChange={(e) => {
                  trainer.mode = e.target.value;
                  update();
                  note(
                    `Virtual workflow: ${trainer.mode}. Original monitor ROM is not emulated.`,
                  );
                }}
              >
                <option>Machine code</option>
                <option>Serial monitor</option>
              </select>
            </label>
          </div>
          <details className="settings" hidden>
            <summary>
              Hardware configuration{" "}
              <span className="amber">UNVERIFIED WIRING</span>
            </summary>
            <p>
              The laboratory PDFs were not attached. Placement, J6, and PPI
              connections need verification. DIP ON grounds its assigned pin.
            </p>
            <label>
              CPU{" "}
              <select
                value={cpu.profile}
                onChange={(e) =>
                  safe(() => {
                    pause();
                    cpu.profile = e.target.value as typeof cpu.profile;
                    trainer.reset();
                  })
                }
              >
                <option>8051</option>
                <option>8031</option>
                <option>8751</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={trainer.monitorInit}
                onChange={(e) => {
                  trainer.monitorInit = e.target.checked;
                  update();
                }}
              />{" "}
              Monitor reset SP=50H
            </label>
            <label>
              <input
                type="checkbox"
                checked={trainer.monitorHook}
                onChange={(e) => {
                  trainer.monitorHook = e.target.checked;
                  update();
                }}
              />{" "}
              Virtual return hook at 8028H
            </label>
            <label>
              <input
                type="checkbox"
                checked={trainer.virtualLCD}
                onChange={(e) => {
                  trainer.virtualLCD = e.target.checked;
                  update();
                }}
              />{" "}
              Virtual LCD bus: C008 command, C009 data
            </label>
            <button
              onClick={() =>
                safe(() => {
                  pause();
                  trainer.hardwareReset();
                })
              }
            >
              Hardware reset · PC=0000 / SP=07
            </button>
            <textarea
              aria-label="Wiring JSON"
              value={wireText}
              onChange={(e) => setWireText(e.target.value)}
              rows={7}
            />
            <button
              onClick={() =>
                safe(() => {
                  trainer.configure(JSON.parse(wireText));
                  note("Wiring configuration applied.");
                })
              }
            >
              Apply wiring
            </button>
            <button
              onClick={() =>
                safe(() => {
                  cpu.setInterruptPin(0, false);
                })
              }
            >
              Release INT0 pin
            </button>
            <label>
              <input
                type="checkbox"
                checked={!!cpu.pullups[0]}
                onChange={(e) => {
                  cpu.pullups[0] = e.target.checked ? 255 : 0;
                  update();
                }}
              />{" "}
              External pull-ups on P0
            </label>
          </details>
          <details className="settings">
            <summary>Expansion modules</summary>
            <div className="module-grid">
              {[
                "8×8 matrix",
                "ADC0804",
                "DAC0800",
                "DC motor",
                "Photo sensor",
                "Stepper driver",
                "Speaker",
                "ROM writer",
              ].map((n) => (
                <div key={n}>
                  {n}
                  <small>NOT IMPLEMENTED</small>
                </div>
              ))}
            </div>
          </details>
        </aside>
        <main className="editor-column">
          <div className="panel-heading">
            <h2>ASSEMBLY WORKSPACE</h2>
            <select
              aria-label="Example library"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  addSource(
                    e.target.value
                      .split(" · ")[0]
                      .toLowerCase()
                      .replaceAll(" ", "-") + ".asm",
                    examples[e.target.value],
                  );
              }}
            >
              <option value="">Load an editable example…</option>
              {Object.keys(examples).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="source-tabs">
            {tabs.map((t) => (
              <div key={t.id} className={t.id === active ? "active" : ""}>
                <button onClick={() => selectSource(t.id)}>
                  {t.name}
                  <span>
                    {t.id === assembledTab && t.source === assembledSource
                      ? ""
                      : " •"}
                  </span>
                </button>
                {tabs.length > 1 && (
                  <button
                    aria-label={`Close ${t.name}`}
                    onClick={() => {
                      setTabs((s) => s.filter((x) => x.id !== t.id));
                      if (active === t.id)
                        selectSource(tabs.find((x) => x.id !== t.id)!.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="editor-wrap">
            <SourceEditor
              key={tab.id}
              value={tab.source}
              onChange={changeSource}
              line={current}
              breakpoints={tab.breakpoints}
              onBreakpoint={toggleBreakpoint}
              errors={fresh ? assembly.errors : []}
            />
          </div>
          <div className="editor-status">
            <span>
              8051 Assembly <i /> UTF-8 <i /> Click gutter to break
            </span>
            <span className={fresh ? "mint" : "amber"}>
              {fresh
                ? assembly.errors.length
                  ? "ASSEMBLY ERRORS"
                  : trainer.programReady
                    ? "ASSEMBLED"
                    : "ASSEMBLE REQUIRED"
                : assembly
                  ? "SOURCE NOT LOADED"
                  : "EDITABLE SOURCE"}
            </span>
          </div>
          <div className="subtabs">
            {["listing", "symbols", "manual bytes", "tutorial"].map((s) => (
              <button
                className={section === s ? "active" : ""}
                key={s}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="workbench-content">
            {section === "listing" && (
              <>
                <div className="table-label">
                  GENERATED MACHINE CODE{" "}
                  <span>
                    {assembly?.listing.reduce(
                      (n, l) => n + l.bytes.length,
                      0,
                    ) ?? 0}{" "}
                    BYTES
                  </span>
                </div>
                <table className="listing">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Machine code</th>
                      <th>Instruction</th>
                      <th>Bytes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assembly?.listing.map((l, i) => (
                      <tr
                        key={i}
                        className={cpu.pc === l.address ? "current" : ""}
                        onClick={() => toggleBreakpoint(l.line)}
                        title="Toggle source breakpoint"
                      >
                        <td>
                          {tab.breakpoints.includes(l.line) ? "● " : ""}
                          {hex(l.address, 4)}
                        </td>
                        <td>{l.bytes.map((b) => hex(b)).join(" ")}</td>
                        <td>{l.instruction}</td>
                        <td>{l.bytes.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!assembly && (
                  <p className="empty">
                    Assemble source to inspect the generated listing.
                    <br />
                    Imported machine code executes directly; see Next
                    instruction.
                  </p>
                )}
              </>
            )}
            {section === "symbols" && (
              <div className="symbols">
                {Object.entries(assembly?.symbols ?? {}).map(([n, v]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <code>{hex(v, 4)}H</code>
                  </div>
                ))}
              </div>
            )}
            {section === "manual bytes" && (
              <div className="manual">
                <p>
                  Load hexadecimal machine-code bytes directly into CODE memory.
                </p>
                <label>
                  Start address{" "}
                  <input
                    value={rawAddress}
                    onChange={(e) => setRawAddress(e.target.value)}
                  />
                </label>
                <textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  aria-label="Machine code bytes"
                />
                <button
                  className="assemble"
                  onClick={() =>
                    safe(() => {
                      pause();
                      const bytes = raw.trim().split(/\s+/);
                      if (bytes.some((b) => !/^([\da-f]{2})$/i.test(b)))
                        throw new Error(
                          "Enter two-digit hexadecimal bytes separated by spaces",
                        );
                      trainer.load(
                        binaryImage(
                          new Uint8Array(bytes.map((b) => parseInt(b, 16))),
                          number(rawAddress),
                        ),
                      );
                      setAssembly(null);
                      note(
                        "Manual bytes loaded. GO and Step execute the same CPU.",
                      );
                    })
                  }
                >
                  Load machine code
                </button>
              </div>
            )}
            {section === "tutorial" && (
              <div className="tutorial">
                <div className="lesson-tabs">
                  {lessons.map((l, i) => (
                    <button
                      className={lesson === i ? "active" : ""}
                      key={i}
                      onClick={() => {
                        setLesson(i);
                        setDone([]);
                      }}
                    >
                      {l.title}
                    </button>
                  ))}
                </div>
                <p className="amber">
                  Based on the supplied brief; manual-specific verification
                  pending.
                </p>
                {lessons[lesson].steps.map((s, i) => (
                  <label key={i}>
                    <input
                      type="checkbox"
                      checked={done.includes(i)}
                      onChange={() =>
                        setDone((d) =>
                          d.includes(i) ? d.filter((n) => n !== i) : [...d, i],
                        )
                      }
                    />
                    <span>
                      <b>{String(i + 1).padStart(2, "0")}</b>
                      {s}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="panel-heading serial-heading" hidden>
            <h2>SERIAL CONSOLE</h2>
            <span>
              {trainer.mode === "Serial monitor"
                ? "VIRTUAL MONITOR COMMANDS"
                : "UART / VIRTUAL RS-232"}
            </span>
          </div>
          <pre className="serial-output" hidden>
            {trainer.serial ||
              (trainer.mode === "Serial monitor"
                ? "Enter HELP for virtual monitor commands."
                : "Waiting for SBUF transmission…")}
          </pre>
          <div className="serial-input" hidden>
            <input
              aria-label="Serial input"
              placeholder={
                trainer.mode === "Serial monitor"
                  ? "HELP · AD 2000 · DA F7 · GO 2000 · REGS"
                  : "Send one character to UART (REN required)"
              }
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
            />
            <button
              onClick={() =>
                safe(() => {
                  if (trainer.mode === "Serial monitor") {
                    pause();
                    const response = trainer.command(serialInput);
                    trainer.serial = (
                      trainer.serial +
                      "\n> " +
                      serialInput +
                      "\n" +
                      response
                    ).slice(-8192);
                    if (/^DA\b/i.test(serialInput) && trainer.space === "CODE")
                      setAssembly(null);
                    if (!trainer.stopped) start();
                  } else {
                    if (serialInput.length !== 1)
                      throw new Error(
                        "Receive one character at a time; SBUF is a one-byte buffer.",
                      );
                    cpu.receive(serialInput.charCodeAt(0));
                  }
                  setSerialInput("");
                })
              }
            >
              Send
            </button>
            <button
              onClick={() => {
                trainer.serial = "";
                update();
              }}
            >
              Clear
            </button>
          </div>
        </main>
        <aside className="inspector-column">
          <div className="panel-heading">
            <h2>CPU INSPECTOR</h2>
            <span className={running ? "mint" : "tag"}>
              {running ? "● RUNNING" : trainer.returned ? "MONITOR" : "PAUSED"}
            </span>
          </div>
          <div className="pc-display">
            <div>
              <span>PROGRAM COUNTER</span>
              <strong>
                {hex(cpu.pc, 4)}
                <small>H</small>
              </strong>
            </div>
            <div className="pulse-icon">⌁</div>
          </div>
          <div className="next-instruction">
            <span>NEXT</span>
            <code>{next}</code>
          </div>
          <div className="registers">
            {stat("A", cpu.a)}
            {stat("B", cpu.b)}
            {stat("SP", cpu.sp)}
            {stat("DPTR", cpu.dptr, 4)}
            {Array.from({ length: 8 }, (_, i) => stat(`R${i}`, cpu.getR(i)))}
          </div>
          <div className="binary-readout">
            ACC{" "}
            <b>
              {cpu.a
                .toString(2)
                .padStart(8, "0")
                .replace(/(.{4})/g, "$1 ")}
            </b>
            <span>bank {(cpu.psw >> 3) & 3}</span>
          </div>
          <div className="small-title">
            PROGRAM STATUS WORD <span>{hex(cpu.psw)}H</span>
          </div>
          <div className="flags">
            {["CY", "AC", "F0", "RS1", "RS0", "OV", "—", "P"].map((n, i) => (
              <button
                key={i}
                className={cpu.psw & (128 >> i) ? "set" : ""}
                onClick={() =>
                  safe(() => {
                    pause();
                    cpu.psw ^= 128 >> i;
                  })
                }
              >
                <span>{n}</span>
                <b>{(cpu.psw >> (7 - i)) & 1}</b>
              </button>
            ))}
          </div>
          <details className="sfr-details">
            <summary>
              All special-function registers{" "}
              <small>double-click values to edit</small>
            </summary>
            <div className="registers">
              {Object.entries(SFR).map(([n, a]) => stat(n, cpu.read(a, true)))}
            </div>
          </details>
          <div className="small-title">
            PORT MONITOR <span>LATCH / PINS</span>
          </div>
          <div className="port-monitor">
            {[0, 1, 2, 3].map((p) => (
              <div key={p}>
                <b>P{p}</b>
                <code>
                  {hex(cpu.read(0x80 + p * 16, true))} <span>→</span>{" "}
                  {hex(cpu.pins(p))}
                </code>
                <div>
                  {Array.from({ length: 8 }, (_, i) => (
                    <button
                      key={i}
                      title={`P${p}.${7 - i}: click to toggle external grounding`}
                      className={cpu.pins(p) & (128 >> i) ? "high" : ""}
                      onClick={() =>
                        safe(() => {
                          if (p === 1)
                            throw new Error(
                              "Use DIP switches and Wiring for Port 1 external inputs.",
                            );
                          const bit = 7 - i,
                            mask = 1 << bit;
                          if (p === 3 && (bit === 2 || bit === 3))
                            cpu.setInterruptPin(
                              (bit - 2) as 0 | 1,
                              !(cpu.externalLow[3] & mask),
                            );
                          else {
                            const wasLow = !!(cpu.externalLow[p] & mask);
                            cpu.externalLow[p] ^= mask;
                            if (p === 3 && (bit === 4 || bit === 5) && !wasLow)
                              cpu.pulseCounter((bit - 4) as 0 | 1);
                          }
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="small-title">
            MEMORY INSPECTOR <span>HEX</span>
          </div>
          <div className="memory-controls">
            <select
              value={memorySpace}
              onChange={(e) => {
                setMemorySpace(e.target.value);
                setMemoryBase(e.target.value === "SFR" ? "80" : "00");
              }}
            >
              {["IRAM", "SFR", "CODE", "XDATA"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input
              aria-label="Memory start address"
              value={memoryBase}
              onChange={(e) => setMemoryBase(e.target.value)}
            />
            <button
              onClick={() => setMemoryBase(hex(Math.max(offset, base - 64), 4))}
            >
              ‹
            </button>
            <button
              onClick={() =>
                setMemoryBase(hex(Math.min(offset + size - 64, base + 64), 4))
              }
            >
              ›
            </button>
          </div>
          <table className="memory-grid">
            <thead>
              <tr>
                <th>Addr</th>
                {Array.from({ length: 8 }, (_, i) => (
                  <th key={i}>{i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a}>
                  <th>{hex(a, 4)}</th>
                  {Array.from({ length: 8 }, (_, i) => {
                    const addr = a + i,
                      valid = addr >= offset && addr < offset + size;
                    return (
                      <td
                        key={i}
                        className={
                          trace?.changes.some(
                            (c) =>
                              c.space === memorySpace && c.address === addr,
                          )
                            ? "changed"
                            : ""
                        }
                      >
                        {valid ? (
                          <button onClick={() => editCell(addr)}>
                            {readCell(addr) === undefined
                              ? "??"
                              : hex(readCell(addr)!)}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="microcopy">
            Click a byte to edit. SFR and IRAM are separate address spaces.
          </p>
          <details className="settings">
            <summary>Watches & address map</summary>
            <div className="watch-input">
              <input
                aria-label="Add watch"
                value={watchInput}
                onChange={(e) => setWatchInput(e.target.value)}
                placeholder="A or IRAM:30 or XDATA:2000"
              />
              <button
                onClick={() =>
                  setWatches((w) => [
                    ...new Set([...w, watchInput.toUpperCase()]),
                  ])
                }
              >
                ＋
              </button>
            </div>
            {watches.map((w) => {
              let val = "?";
              try {
                const snap = cpu.snapshot();
                if (w in snap)
                  val = hex(snap[w], w === "PC" || w === "DPTR" ? 4 : 2);
                else {
                  const [s, addr] = w.includes(":")
                    ? w.split(":")
                    : ["IRAM", w];
                  const a = number(addr);
                  val = hex(
                    s === "XDATA"
                      ? cpu.peekX(a)
                      : s === "CODE"
                        ? cpu.code[a]
                        : s === "SFR"
                          ? cpu.read(a, true)
                          : cpu.ram[a],
                  );
                }
              } catch {}
              return (
                <div className="watch" key={w}>
                  <span>{w}</span>
                  <code>{val}</code>
                  <button
                    onClick={() => setWatches((v) => v.filter((x) => x !== w))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {memoryMap.map(([range, name]) => (
              <div className="map-row" key={range}>
                <code>{range}</code>
                <span>{name}</span>
              </div>
            ))}
          </details>
        </aside>
      </div>
      <section className="debugger">
        <div className="debugger-bar">
          <h2>EXECUTION DESK</h2>
          <div className="counters">
            <span>
              <b>{cpu.instructions.toLocaleString()}</b> instructions
            </span>
            <span>
              <b>{cpu.cycles.toLocaleString()}</b> machine cycles
            </span>
            <span>
              <b>{(((cpu.cycles * 12) / cpu.clock) * 1000).toFixed(3)}</b> ms
              simulated
            </span>
          </div>
          <label>
            Speed{" "}
            <input
              aria-label="Execution speed"
              type="range"
              min="0"
              max="5"
              step="1"
              value={[4, 20, 100, 400, 4000, 40000].indexOf(speed)}
              onChange={(e) =>
                setSpeed([4, 20, 100, 400, 4000, 40000][+e.target.value])
              }
            />
            <span>{speed.toLocaleString()} ins/s</span>
          </label>
        </div>
        <div className="debugger-grid">
          <div className="diagnostics">
            <h3>DIAGNOSTICS</h3>
            {diagnostics.slice(0, 8).map((d, i) => (
              <pre key={i}>
                <span>{String(diagnostics.length - i).padStart(2, "0")}</span>
                {d}
              </pre>
            ))}
          </div>
          <div className="trace">
            <h3>INSTRUCTION / BEFORE → AFTER</h3>
            {trace ? (
              <>
                <div className="trace-instruction">
                  <code>
                    {hex(trace.pc, 4)} <strong>{trace.text}</strong>
                  </code>
                  <span>
                    {trace.bytes.map((b) => hex(b)).join(" ")} · {trace.cycles}{" "}
                    cycles
                  </span>
                </div>
                <p>
                  {fresh && assembly.listing.find((l) => l.address === trace.pc)
                    ? `Source line ${assembly.listing.find((l) => l.address === trace.pc)!.line} · `
                    : ""}
                  {trace.explanation}
                </p>
                <div className="trace-deltas">
                  {Object.keys(trace.before)
                    .filter((n) => trace.before[n] !== trace.after[n])
                    .map((n) => (
                      <span key={n}>
                        {n}{" "}
                        <b>
                          {hex(trace.before[n], n === "PC" ? 4 : 2)} →{" "}
                          {hex(trace.after[n], n === "PC" ? 4 : 2)}
                        </b>
                      </span>
                    ))}
                </div>
                <details>
                  <summary>
                    Full before/after snapshot · {trace.changes.length} writes
                  </summary>
                  <pre>
                    {Object.keys(trace.before)
                      .map(
                        (n) =>
                          `${n.padEnd(7)} ${hex(trace.before[n], 4)} → ${hex(trace.after[n], 4)}`,
                      )
                      .join("\n")}
                  </pre>
                  {trace.changes.map((c, i) => (
                    <div key={i}>
                      <code>
                        {c.space} {hex(c.address, 4)}: {hex(c.before)} →{" "}
                        {hex(c.after)}
                      </code>
                    </div>
                  ))}
                </details>
              </>
            ) : (
              <p className="empty">
                Step an instruction to inspect its effects.
              </p>
            )}
          </div>
          <div className="history">
            <h3>
              EXECUTION HISTORY <span>LAST 200</span>
            </h3>
            {trainer.history
              .slice(-30)
              .reverse()
              .map((t, i) => (
                <button
                  key={trainer.history.length - i}
                  onClick={() => setSelectedTrace(t)}
                >
                  <code>{hex(t.pc, 4)}</code>
                  <span>{t.text}</span>
                  <small>{t.cycles}T</small>
                </button>
              ))}
          </div>
        </div>
      </section>
      <footer>
        <span>
          <i className="online-dot" />
          All computation stays in this browser · sources autosaved locally
        </span>
        <span>Standard MCS-51 / provisional MDA board profile</span>
      </footer>
    </div>
  );
}
