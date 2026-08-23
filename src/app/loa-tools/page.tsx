import { createClient } from "@/lib/supabase/server";
import LoaToolsTabs from "@/components/LoaToolsTabs";

export default async function LoaToolsPage() {
  const supabase = await createClient();
  // middleware가 이미 getUser()로 세션을 검증한 뒤에만 여기 도달하므로, 여기서는 네트워크 호출 없는
  // getSession()으로 충분함(탭 이동마다 인증 확인이 중복으로 여러 번 일어나던 걸 줄이기 위함).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">로아 도구</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        레이드 경매·더보기 관련 계산기 모음이에요.
      </p>

      <LoaToolsTabs />
    </main>
  );
}
