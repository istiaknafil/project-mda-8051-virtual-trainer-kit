# Validation record

## LED execution regression — 24 November 2026

- **335 tests passed; 0 failed. Production build and strict TypeScript check passed.**
- Added coverage for all 16 DIP states before loading code, firmware that reads without writing P1, seven different P1-writing programs, same-value writes, raw machine code, reset/source invalidation and failed assembly.
- Browser: with DIP 1 on, Run before assembly executed zero instructions and lit zero LEDs. Assembly alone and the first five instructions kept all LEDs off. The sixth instruction (`MOV P1,A`) lit one LED with latch FEH and pins EEH.
- Browser: editing required reassembly and cleared the output. A separate `MOV P1,#0AAH` program lit four LEDs after one instruction. An `ORL:` syntax error prevented execution and left all LEDs off.

## Original validation

Validated on Windows with Node 24.20.0. Date: 13 November 2026 (Asia/Dhaka).

## Automated checks

- **321 Vitest tests passed; 0 failed.**
- **Production build and strict TypeScript check passed.**
- **npm audit: 0 vulnerabilities** reported for the delivered dependency set.

Coverage includes an independent 256-slot opcode fixture (255 valid, A5 reserved), instruction lengths, encoder/decoder/execution coverage for every standard opcode, exact experiment byte sequences, directives and forward references, expression parsing, branch/page bounds, invalid input and HEX validation.

Semantic tests exercise register banks, separate memory spaces, nested calls, PUSH/POP including SP aliasing, arithmetic boundary cases with independent signed/unsigned oracles, all 10,000 two-digit packed-BCD addition pairs, multiply/divide, rotations, nibble exchange, Boolean operations, branch conditions, MOVC/MOVX and port pin/latch distinctions.

Peripheral tests exercise timer modes 0/1/2/3, counter pulses and gate control, machine-cycle advancement, interrupt vectors/stacking/priorities/RETI and IE deferral, UART transmit/receive, keypad memory operations, side-effect-free debugger peeks, virtual serial monitor commands, opt-in LCD operation, explicit unavailable-device faults, and all 16 DIP combinations in Experiment 02.

The independent external test compiles the supplied fixture using **SDCC 4.4.0 #14620** outside the browser, then loads the actual `.ihx` output. Executing 2,000 instructions reaches IRAM[30H]=05H, P1=F7H and the loop at PC=0075H, including compiler-generated startup code.

## Browser checks observed

- Experiment 01 assembled to seven expected bytes; three Step clicks reached PC=8028H, A=F7H, PSW=01H, SP=50H and lit LED 5.
- An editable loop reached A=05H/R0=00H. Editing the source count to 9 and reassembling changed A to 09H.
- Experiment 02 accepted a DIP change while running; P1 latch FEH and resolved pins EEH were displayed with DIP 1 grounded.
- A breakpoint at SWAP A stopped at 0035H. Resume executed five further loop instructions and stopped there again.
- Save downloaded a real `.asm` file. Open reopened that saved file into an editable source tab.
- Open accepted the SDCC `.ihx` file and validated it. Run reached PC=0075H; the memory inspector showed 05H at 0030H and the port inspector showed F7H.
- A 1366×768 laptop viewport displayed the trainer, source editor and CPU inspector in three columns. The narrower initial viewport used the responsive layout.
- No browser console errors were observed during the checked workflows. A development hot-reload interruption was resolved by reloading the tab; the production build is checked separately.

These checks validate the observed paths and broad engine behavior. They do not verify the absent laboratory diagrams, simulate analog electrical effects, or certify arbitrary external firmware. The README lists the remaining scope limits.

Reproduce with `npm.cmd ci`, `npm.cmd test`, and `npm.cmd run build`. The external compiler fixture is committed, so test runs do not require installing SDCC or using the Internet after dependencies are installed.
