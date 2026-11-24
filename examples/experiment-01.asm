; MDA monitor initialization sets SP=50H (selectable).
; Provisional active-low mapping: LED 5 = P1.3.
ORG 2000H
    MOV A,#0F7H
    MOV P1,A
    JMP 8028H
END
