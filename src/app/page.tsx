import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekKey, getTimeUntilReset } from "@/lib/week";
import { loadDashboardData } from "@/lib/dashboardData";
import Dashboard from "@/components/Dashboard";

export default async function HomePage() {
  const supabase = await createClient();
  // middleware가 이미 getUser()로 세션을 검증한 뒤에만 여기 도달하므로, 여기서는 네트워크 호출 없이
  // 쿠키에 저장된 세션을 그대로 읽기만 하는 getSession()으로 충분함(탭 이동마다 인증 확인이 중복으로
  // 여러 번 일어나던 걸 줄이기 위함).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return null; // middleware가 /login으로 보내지만, 타입 좁히기용

  const weekKey = getCurrentWeekKey();

  const { profiles, characters, raids, checks, characterRaids, loadWarning } = await loadDashboardData(
    supabase,
    weekKey
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">이번 주 숙제 현황</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          이번 주({weekKey} 06:00부터) · 다음 초기화까지 {getTimeUntilReset()}
        </p>
      </div>

      {loadWarning && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
          ⚠ {loadWarning}
        </p>
      )}

      <Dashboard
        mode="mine"
        currentUserId={user.id}
        weekKey={weekKey}
        profiles={profiles}
        characters={characters}
        raids={raids}
        initialChecks={checks}
        initialCharacterRaids={characterRaids}
      />
    </main>
  );
}
