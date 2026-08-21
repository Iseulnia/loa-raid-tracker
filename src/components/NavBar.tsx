import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import ThemeToggle from "@/components/ThemeToggle";

export default async function NavBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", user.id)
    .single();

  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/" className="text-neutral-900 dark:text-neutral-100">
            대시보드
          </Link>
          <Link
            href="/party"
            className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            공격대
          </Link>
          <Link
            href="/characters"
            className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            내 캐릭터
          </Link>
          <Link
            href="/auto-detect"
            className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            자동 감지
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400">
          <ThemeToggle />
          <span>{profile?.nickname ?? user.email}님</span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
