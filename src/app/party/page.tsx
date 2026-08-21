import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekKey, getTimeUntilReset } from "@/lib/week";
import Dashboard from "@/components/Dashboard";

export default async function PartyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const weekKey = getCurrentWeekKey();

  const [{ data: profiles }, { data: characters }, { data: raids }, { data: checks }, { data: characterRaids }] =
    await Promise.all([
      supabase.from("profiles").select("id, nickname"),
      supabase
        .from("characters")
        .select(
          "id, owner_id, name, server, class, item_level, combat_power, is_gold_earner, expedition_label, is_main_character, sort_order"
        )
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
      supabase.from("character_raids").select("character_id, raid_id, is_gold_earning"),
    ]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">공격대 현황</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          이번 주({weekKey} 06:00부터) · 다음 초기화까지 {getTimeUntilReset()}
        </p>
      </div>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        친구들 전체의 이번 주 체크 현황을 한눈에 볼 수 있는 공용 탭이에요. 내 캐릭터만 체크할 수 있고, 다른
        사람 캐릭터는 보기만 가능해요.
      </p>

      <Dashboard
        mode="party"
        currentUserId={user.id}
        weekKey={weekKey}
        profiles={profiles ?? []}
        characters={characters ?? []}
        raids={raids ?? []}
        initialChecks={checks ?? []}
        initialCharacterRaids={characterRaids ?? []}
      />
    </main>
  );
}
