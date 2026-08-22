"use client";

import { useEffect, useRef, useState } from "react";

/** 숫자가 바뀔 때 이전 값에서 새 값으로 부드럽게 이어지도록 매 프레임 보간한다 (ease-out). */
export function useAnimatedNumber(value: number, durationMs = 500): number {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) return;

    let rafId: number;
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, durationMs]);

  return display;
}

/** 골드/개수처럼 값이 바뀌는 숫자를 부드럽게 오르내리도록 보여주는 <span>. */
export default function AnimatedNumber({
  value,
  durationMs = 500,
  format,
  className,
}: {
  value: number;
  durationMs?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const display = useAnimatedNumber(value, durationMs);
  const rounded = Math.round(display);
  return <span className={className}>{format ? format(rounded) : rounded.toLocaleString()}</span>;
}
