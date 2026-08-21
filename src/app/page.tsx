import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekKey, getTimeUntilReset } from "@/lib/week";
import Dashboard from "@/components/Dashboard";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware가 /login으로 보내지만, 타입 좁히기용

  const weekKey = getCurrentWeekKey();

  const [{ data: profiles }, { data: characters }, { data: raids }, { data: checks }] =
    await Promise.all([
      supabase.from("profiles").select("id, nickname"),
      supabase
        .from("characters")
        .select("id, owner_id, name, server, class, item_level, combat_power, is_gold_earner, sort_order")
        .order("sort_order"),
      supabase
        .from("raids")
        .select("id, name, difficulty, min_item_level, gate_count, gold_per_gate, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("weekly_checks")
        .select("id, character_id, raid_id, gate_number, week_key, checked_by")
        .eq("week_key", weekKey),
    ]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">이번 주 숙제 현황</h1>
        <p className="text-sm text-neutral-500">
          이번 주({weekKey} 06:00부터) · 다음 초기화까지 {getTimeUntilReset()}
        </p>
      </div>

      <Dashboard
        currentUserId={user.id}
        weekKey={weekKey}
        profiles={profiles ?? []}
        characters={characters ?? []}
        raids={raids ?? []}
        initialChecks={checks ?? []}
      />
    </main>
  );
}
