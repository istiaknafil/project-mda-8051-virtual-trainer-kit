; Enable Virtual LCD bus in Hardware settings.
; C008 command / C009 data is a virtual API, not verified MDA PPI wiring.
ORG 0
MOV DPTR,#0C008H
MOV A,#1
MOVX @DPTR,A
INC DPTR
MOV A,#'H'
MOVX @DPTR,A
MOV A,#'i'
MOVX @DPTR,A
STOP: SJMP STOP
END
