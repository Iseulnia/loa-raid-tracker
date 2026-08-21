"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "대시보드" },
  { href: "/party", label: "공격대" },
  { href: "/characters", label: "내 캐릭터" },
  { href: "/auto-detect", label: "자동 감지" },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4 text-sm">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? "font-semibold text-neutral-900 dark:text-neutral-100"
                : "font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
