# Hardware verification ledger

The attachment contained the project brief only. No university-manual PDF or circuit scan was available. This ledger separates facts supplied in that brief from implementation choices.

| Item | Evidence available | Current handling |
|---|---|---|
| Clock 11.0592 MHz; classic 12T CPU | Project brief | Implemented as machine-cycle timing |
| Experiment 01 bytes at 2000H | Explicit byte sequence in brief | Assembled dynamically; exact automated comparison |
| A=F7, PSW=01, SP=50 result | Brief | CPU computes A/PSW; selected virtual monitor initialization sets SP=50 before execution |
| LED 5 lights for P1=F7H | Brief | Deduces LED 5 is driven active-low from P1.3 for this exercise; mapping remains configurable |
| Remaining LED order | Missing circuit | Provisional descending P1.7…P1.0, explicitly unverified |
| DIP pin mapping and J6 routing | Missing circuit | Provisional P1.4…P1.7 switches to ground; editable JSON |
| PCB positions, socket/connector labels | Missing diagram | Original illustrative layout; no reproduction claim |
| Address regions | Table in brief | Implemented decoder boundary table; unimplemented devices throw |
| CODE/XDATA physical RAM aliasing | Insufficient evidence | Separate memories, no automatic aliasing |
| Keyboard register protocol | Region ranges only | Virtual flag C000…C003 and data C004…C007; reading data acknowledges virtual flag |
| LCD/writer 8255 individual registers | Missing manual | Not guessed; real PPI unavailable |
| LCD command/data interface | No circuit | Explicit opt-in virtual API at C008/C009, not a board wiring assertion |
| Original serial monitor commands | Missing monitor documentation | New documented virtual command language |
| Monitor ROM and undocumented services | No ROM image | None fabricated; fetching unpopulated monitor CODE faults |
| Return at 8028H | Explicit brief | Optional virtual monitor stop hook |
| ADC/DAC/motors/speaker/writers/matrix | Names/regions only | Declared unavailable; modular CPU bus hooks permit later addition |

Wiring JSON schema:

```json
{
  "dipPins": [4, 5, 6, 7],
  "ledPins": [7, 6, 5, 4, 3, 2, 1, 0],
  "activeLow": true,
  "ledSource": "latch"
}
```

Arrays map DIP 1–4 and LED 1–8 to Port 1 bit numbers. A DIP in the ON position pulls its assigned pin low. P1's output latch and the external grounding mask resolve the pin value; the CPU only receives the result when it executes a pin-reading instruction. Read-modify-write instructions read latches. By default LEDs display the output latch using their configured polarity, so a DIP cannot light an LED without firmware processing the input. Optional `ledSource: "pins"` displays resolved pins instead. Both modes keep LEDs off until a successfully loaded program executes a P1 write. Reset, source changes and failed assembly clear that execution gate. This is a virtual display policy, not a claim about unverified physical wiring.

To complete manual fidelity, inspect both PDFs' system and J6 circuits, record their page numbers and actual PPI register assignments, update the board profile, and add independent truth-table tests from the diagrams. Do not reinterpret the provisional defaults as verified hardware.
