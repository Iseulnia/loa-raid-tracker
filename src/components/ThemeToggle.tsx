"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // 마운트 시점에 실제 DOM(.dark 클래스, layout.tsx의 초기화 스크립트가 이미 설정해둠)을 한 번만 읽어와
    // 서버 렌더링(항상 라이트로 렌더)과 하이드레이션 불일치를 피하는 의도된 패턴.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage 접근 불가 시(프라이빗 모드 등) 그냥 이번 세션에서만 적용됨
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="다크 모드 전환"
      className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
    >
      {isDark ? "☀️ 라이트" : "🌙 다크"}
    </button>
  );
}
