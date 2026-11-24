; DIP switches ground P1.4–P1.7 in the provisional wiring.
; Verify against your manual or edit Wiring.
ORG 0000H
    JMP START
ORG 0030H
START:
    MOV PSW,#00H
LOOP:
    MOV A,P1
    SWAP A
    ORL A,#0F0H
    MOV P1,A
    JMP LOOP
END
