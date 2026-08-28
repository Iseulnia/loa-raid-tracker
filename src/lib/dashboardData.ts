import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Profile = { id: string; nickname: string };
type CharacterRow = Database["public"]["Tables"]["characters"]["Row"];
type RaidRow = Database["public"]["Tables"]["raids"]["Row"];
type CheckRow = Database["public"]["Tables"]["weekly_checks"]["Row"];
type CharacterRaidRow = { character_id: string; raid_id: string; is_gold_earning: boolean };

/**
 * 대시보드에 필요한 쿼리 하나를 실행하고, 실패하면 짧게 기다렸다가 재시도한다.
 *
 * 예전엔 Promise.all로 5개 쿼리를 병렬 조회하면서 각각의 error를 확인하지 않고 `data ?? []`로
 * 넘겨버렸다 — 그러면 일시적인 네트워크/DB 오류로 조회가 실패해도 "데이터가 없다"로 표시돼서, 방금
 * 저장한 숙제가 안 보이는 게 "저장이 안 됐다"처럼 보이는 문제(실제로는 SSR 시점 조회 실패)가 있었다.
 * 재시도로 대부분의 일시적 실패는 자체적으로 복구되고, 그래도 실패하면 그 사실을 호출부에 알린다.
 */
async function queryWithRetry<T>(
  label: string,
  run: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  retries = 2
): Promise<{ data: T | null; failed: boolean }> {
  let lastErrorMessage: string | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await run();
    if (!error) return { data, failed: false };
    lastErrorMessage = error.message;
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  console.error(`[dashboardData] ${label} 조회 실패(재시도 ${retries}회 소진):`, lastErrorMessage);
  return { data: null, failed: true };
}

export async function loadDashboardData(supabase: SupabaseClient<Database>, weekKey: string) {
  const [profiles, characters, raids, checks, characterRaids] = await Promise.all([
    queryWithRetry("profiles", () => supabase.from("profiles").select("id, nickname")),
    queryWithRetry("characters", () =>
      supabase
        .from("characters")
        .select(
          "id, owner_id, name, server, class, item_level, combat_power, class_engraving, is_gold_earner, expedition_label, is_main_character, sort_order"
        )
        .order("sort_order")
    ),
    queryWithRetry("raids", () =>
      supabase
        .from("raids")
        .select("id, name, difficulty, min_item_level, gate_count, gold_per_gate, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order")
    ),
    queryWithRetry("weekly_checks", () =>
      supabase
        .from("weekly_checks")
        .select("id, character_id, raid_id, gate_number, week_key, checked_by")
        .eq("week_key", weekKey)
    ),
    queryWithRetry("character_raids", () =>
      supabase.from("character_raids").select("character_id, raid_id, is_gold_earning")
    ),
  ]);

  const failedLabels = [
    characters.failed && "캐릭터",
    raids.failed && "레이드",
    checks.failed && "체크",
    characterRaids.failed && "숙제 선택",
  ].filter((v): v is string => Boolean(v));

  return {
    profiles: (profiles.data as Profile[] | null) ?? [],
    characters: (characters.data as CharacterRow[] | null) ?? [],
    raids: (raids.data as RaidRow[] | null) ?? [],
    checks: (checks.data as CheckRow[] | null) ?? [],
    characterRaids: (characterRaids.data as CharacterRaidRow[] | null) ?? [],
    loadWarning:
      failedLabels.length > 0
        ? `${failedLabels.join(", ")} 정보를 서버에서 불러오지 못했어요. 새로고침해서 다시 시도해주세요.`
        : null,
  };
}
