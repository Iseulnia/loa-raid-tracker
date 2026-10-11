"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "대시보드" },
  { href: "/party", label: "공격대" },
  { href: "/characters", label: "내 캐릭터" },
  { href: "/auto-detect", label: "체크 자동화", matchPrefixes: ["/auto-detect", "/menu-detect"] },
  { href: "/loa-tools", label: "로아 도구" },
];

// 자주 쓰는 외부 사이트 바로가기 — 이 앱의 페이지가 아니라서 새 탭으로 연다.
const EXTERNAL_LINKS = [
  { href: "https://loatto.kr/gempago", label: "젬파고" },
  { href: "https://aloa.gg/ko/arkgrid", label: "젬 최적화" },
];

const INACTIVE_CLASS =
  "font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4 text-sm">
      {LINKS.map((link) => {
        const active = link.href === "/"
          ? pathname === "/"
          : (link.matchPrefixes ?? [link.href]).some((prefix) => pathname.startsWith(prefix));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? "font-semibold text-neutral-900 dark:text-neutral-100" : INACTIVE_CLASS}
          >
            {link.label}
          </Link>
        );
      })}
      {EXTERNAL_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`${link.label} (새 탭에서 열기)`}
          className={`${INACTIVE_CLASS} inline-flex items-center gap-0.5`}
        >
          {link.label}
          {/* 다른 탭들과 달리 사이트를 벗어난다는 걸 미리 알 수 있게 작은 화살표를 붙인다 */}
          <span aria-hidden="true" className="text-[10px] opacity-60">↗</span>
        </a>
      ))}
    </nav>
  );
}
