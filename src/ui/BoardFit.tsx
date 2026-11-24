import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Keep the complete physical board in view without changing CPU state. */
export function BoardFit({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const resize = () => {
      if (!host.current || !content.current) return;
      setScale(
        Math.min(
          host.current.clientWidth / 320,
          host.current.clientHeight / content.current.offsetHeight,
          1.35,
        ),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current!);
    observer.observe(content.current!);
    resize();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="board-fit" ref={host}>
      <div
        className="board-fit-content"
        ref={content}
        style={{ transform: `translateX(-50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
