/* External compiler compatibility fixture. This C source is compiled by SDCC,
   not by the browser application. Result: IRAM[0x30]=5, P1 latch=0xF7. */
__sfr __at (0x90) P1;
volatile __data __at (0x30) unsigned char result;
void main(void) {
    unsigned char i;
    result = 0;
    for (i = 0; i < 5; ++i) result++;
    P1 = 0xf7;
    while (1) { }
}
