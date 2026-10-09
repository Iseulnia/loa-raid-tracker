"use client";

import { useEffect, useRef, useState } from "react";

/** 누르면 정해진 텍스트를 클립보드에 복사하는 작은 버튼 (상단 바의 "/탈출" 버튼 등). */
export default function CopyTextButton({ text, label = text }: { text: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  async function handleClick() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // 클립보드 API가 막힌 환경(오래된 브라우저, 포커스가 없는 상태 등)용 예전 방식 대체
      ok = copyWithTextarea(text);
    }
    setStatus(ok ? "copied" : "failed");
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus("idle"), 1200);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`"${text}" 복사`}
      className={[
        "rounded-md border px-2 py-1 text-xs transition-colors",
        status === "copied"
          ? "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
          : status === "failed"
          ? "border-red-300 text-red-500 dark:border-red-800 dark:text-red-400"
          : "border-neutral-200 text-neutral-500 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200",
      ].join(" ")}
    >
      {/* 세 문구를 같은 칸에 겹쳐두고 보이는 것만 바꿔서, 문구 길이가 달라도 버튼 폭이 안 흔들리게 한다
          (폭이 바뀌면 바로 옆 로그아웃 버튼이 밀려서 잘못 누르기 쉬움). */}
      <span className="grid">
        <span className={["col-start-1 row-start-1", status === "idle" ? "" : "invisible"].join(" ")}>{label}</span>
        <span className={["col-start-1 row-start-1", status === "copied" ? "" : "invisible"].join(" ")}>복사됨</span>
        <span className={["col-start-1 row-start-1", status === "failed" ? "" : "invisible"].join(" ")}>복사 실패</span>
      </span>
    </button>
  );
}

function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
