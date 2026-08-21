import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";

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
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/" className="text-neutral-900">
            대시보드
          </Link>
          <Link href="/characters" className="text-neutral-500 hover:text-neutral-900">
            내 캐릭터
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span>{profile?.nickname ?? user.email}님</span>
          <form action={signOut}>
            <button type="submit" className="text-neutral-400 hover:text-neutral-700">
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
