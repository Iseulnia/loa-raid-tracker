import { createClient } from "@/lib/supabase/server";
import LoaToolsTabs from "@/components/LoaToolsTabs";

export default async function LoaToolsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
