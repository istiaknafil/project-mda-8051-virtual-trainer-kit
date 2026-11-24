import { useEffect, useRef } from "react";
import {
  EditorState,
  StateEffect,
  StateField,
  RangeSet,
} from "@codemirror/state";
import {
  EditorView,
  Decoration,
  gutter,
  GutterMarker,
  keymap,
} from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  StreamLanguage,
  foldService,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import { tags } from "@lezer/highlight";
import { setDiagnostics } from "@codemirror/lint";
import type { Diagnostic } from "../assembler";
const currentLine = StateEffect.define<number>();
const currentField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(currentLine)) {
        const line = e.value;
        if (line > 0 && line <= tr.state.doc.lines)
          value = Decoration.set([
            Decoration.line({ class: "executing-line" }).range(
              tr.state.doc.line(line).from,
            ),
          ]);
        else value = Decoration.none;
      }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
class Dot extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.textContent = "●";
    el.style.color = "#ff827b";
    return el;
  }
}
const bpEffect = StateEffect.define<number[]>();
const bpField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(bpEffect))
        value = RangeSet.of(
          e.value
            .filter((n) => n > 0 && n <= tr.state.doc.lines)
            .sort((a, b) => a - b)
            .map((n) => new Dot().range(tr.state.doc.line(n).from)),
        );
    return value;
  },
});
const assembly = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/;.*/)) return "comment";
    if (stream.match(/(?:"[^"]*"|'[^']*')/)) return "string";
    if (stream.match(/\b(?:0x[\da-f]+|\d[\da-f]*h|[01]+b|\d+)\b/i))
      return "number";
    if (stream.match(/^[\w?$]+:/)) return "labelName";
    if (
      stream.match(
        /\b(?:movx?|movc|addc?|subb|inc|dec|mul|div|da|anl|orl|xrl|clr|cpl|swap|rlc?|rrc?|setb|sjmp|ajmp|ljmp|jmp|jz|jnz|jc|jnc|jb|jnb|jbc|cjne|djnz|acall|lcall|ret|reti|nop|push|pop|xchd?|org|equ|db|dw|ds|end)\b/i,
      )
    )
      return "keyword";
    if (stream.match(/\b(?:a|b|c|r[0-7]|p[0-3]|psw|sp|dptr|acc)\b/i))
      return "variableName";
    stream.next();
    return null;
  },
});
export function SourceEditor({
  value,
  onChange,
  line,
  breakpoints,
  onBreakpoint,
  errors,
}: {
  value: string;
  onChange: (v: string) => void;
  line: number;
  breakpoints: number[];
  onBreakpoint: (n: number) => void;
  errors: Diagnostic[];
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callbacks = useRef({ onChange, onBreakpoint });
  callbacks.current = { onChange, onBreakpoint };
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: "#1659bf", fontWeight: "600" },
              { tag: tags.number, color: "#9a4c00" },
              { tag: tags.comment, color: "#59718c", fontStyle: "italic" },
              { tag: tags.variableName, color: "#8041a6" },
              { tag: tags.labelName, color: "#075985", fontWeight: "600" },
              { tag: tags.string, color: "#067557" },
            ]),
          ),
          assembly,
          keymap.of([indentWithTab]),
          currentField,
          bpField,
          gutter({
            class: "breakpoint-gutter",
            markers: (v) => v.state.field(bpField),
            initialSpacer: () => new Dot(),
            domEventHandlers: {
              mousedown(v, l) {
                callbacks.current.onBreakpoint(
                  v.state.doc.lineAt(l.from).number,
                );
                return true;
              },
            },
          }),
          foldService.of((state, start) => {
            const l = state.doc.lineAt(start);
            if (!/^\s*[\w?$]+:/.test(l.text)) return null;
            let end = l.to;
            for (let n = l.number + 1; n <= state.doc.lines; n++) {
              const next = state.doc.line(n);
              if (/^\s*[\w?$]+:/.test(next.text)) break;
              end = next.to;
            }
            return end > l.to ? { from: l.to, to: end } : null;
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged)
              callbacks.current.onChange(u.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "Consolas, monospace",
              fontSize: "calc(16px * var(--text-scale, 1))",
            },
            ".cm-content": { padding: "14px 0" },
            ".cm-gutters": { backgroundColor: "#edf4fd", border: "none" },
            ".executing-line": { backgroundColor: "#d9eaff" },
            ".breakpoint-gutter .cm-gutterElement": {
              cursor: "pointer",
              minWidth: "14px",
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, []);
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
      });
  }, [value]);
  useEffect(() => {
    const v = view.current;
    if (v) {
      v.dispatch({ effects: [currentLine.of(line), bpEffect.of(breakpoints)] });
      v.dispatch(
        setDiagnostics(
          v.state,
          errors
            .filter((e) => e.line <= v.state.doc.lines)
            .map((e) => ({
              from: v.state.doc.line(e.line).from,
              to: v.state.doc.line(e.line).to,
              severity: "error" as const,
              message: e.message,
            })),
        ),
      );
    }
  }, [line, breakpoints, errors, value]);
  return <div className="source-editor" ref={host} />;
}
