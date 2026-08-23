import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import ThemeToggle from "@/components/ThemeToggle";
import NavLinks from "@/components/NavLinks";

export default async function NavBar() {
  const supabase = await createClient();
  // middleware가 이미 getUser()로 세션을 검증한 뒤에만 여기 도달하므로, 여기서는 네트워크 호출 없는
  // getSession()으로 충분함(탭 이동마다 인증 확인이 중복으로 여러 번 일어나던 걸 줄이기 위함).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", user.id)
    .single();

  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <NavLinks />
        <div className="flex items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400">
          <ThemeToggle />
          <span>{profile?.nickname ?? user.email}님</span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-neutral-400 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
