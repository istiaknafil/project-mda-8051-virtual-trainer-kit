# External firmware fixture

`external-sdcc.ihx` was actually compiled from the accompanying C file using SDCC 4.4.0 #14620 (MINGW32), distributed by PlatformIO as `platformio/toolchain-sdcc@1.40400.0`.

Command:

```powershell
sdcc.exe -mmcs51 --model-small --iram-size 128 --code-size 65536 external-sdcc.c -o external-sdcc.ihx
```

The Windows package's `bin/cc1` PE executable needed a `cc1.exe` copy for sdcpp to launch it; its `bin` directory was added to PATH for that test process only. The compiler was installed in the task's scratch directory, not bundled into this application.

Import `external-sdcc.ihx` with Open, then Run. Expected after startup: internal RAM address 30H = 05H; P1 latch = F7H; PC settles in the SJMP loop at 0075H. With provisional wiring, LED 5 lights. The automated integration test runs 2,000 real CPU instructions from this HEX image, including SDCC's startup code.

This validates a concrete external firmware path, not all Keil/SDCC outputs or derivative-chip peripherals. The browser does not compile C.

Package metadata: https://registry.platformio.org/tools/platformio/toolchain-sdcc

Compiler project: https://sdcc.sourceforge.net/
