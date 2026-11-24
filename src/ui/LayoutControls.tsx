import { useEffect, useState } from "react";

const defaults = { zoom: 100, board: 24, inspector: 25, editor: 68, desk: 140 };
export function useLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("mda8051.layout") || "null",
      );
      if (
        value &&
        Object.keys(defaults).every((key) => Number.isFinite(value[key]))
      )
        return {
          zoom: Math.max(90, Math.min(150, value.zoom)),
          board: Math.max(18, Math.min(30, value.board)),
          inspector: Math.max(20, Math.min(32, value.inspector)),
          editor: Math.max(35, Math.min(85, value.editor)),
          desk: Math.max(80, Math.min(240, value.desk)),
        };
    } catch {}
    return defaults;
  });
  useEffect(() => {
    try {
      localStorage.setItem("mda8051.layout", JSON.stringify(layout));
    } catch {}
  }, [layout]);
  return { layout, setLayout, reset: () => setLayout(defaults) };
}

export function LayoutControls({
  layout,
  setLayout,
  reset,
}: ReturnType<typeof useLayout>) {
  return (
    <div className="view-controls" aria-label="Workspace view controls">
      <span>Text</span>
      <button
        aria-label="Zoom out"
        disabled={layout.zoom <= 90}
        onClick={() =>
          setLayout((v) => ({ ...v, zoom: Math.max(90, v.zoom - 10) }))
        }
      >
        −
      </button>
      <output aria-label="Text zoom">{layout.zoom}%</output>
      <button
        aria-label="Zoom in"
        disabled={layout.zoom >= 150}
        onClick={() =>
          setLayout((v) => ({ ...v, zoom: Math.min(150, v.zoom + 10) }))
        }
      >
        +
      </button>
      <button
        onClick={reset}
        title="Reset zoom and panel sizes to fit the window"
      >
        Fit window
      </button>
      <details className="layout-menu">
        <summary>Layout</summary>
        <div>
          <strong>Adjust your workspace</strong>
          {(
            [
              ["board", "Board width", 18, 30, "%"],
              ["inspector", "Inspector width", 20, 32, "%"],
              ["editor", "Editor height", 35, 85, "%"],
              ["desk", "Execution desk height", 80, 240, "px"],
            ] as const
          ).map(([key, label, min, max, unit]) => (
            <label key={key}>
              {label}
              <output>
                {layout[key]}
                {unit}
              </output>
              <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                value={layout[key]}
                onChange={(e) =>
                  setLayout((v) => ({ ...v, [key]: +e.target.value }))
                }
              />
            </label>
          ))}
          <p>
            The board fits automatically. Long content scrolls inside its panel.
          </p>
          <button onClick={reset}>Restore default layout</button>
        </div>
      </details>
    </div>
  );
}
