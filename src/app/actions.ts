"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekKey } from "@/lib/week";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요해요.");
  return { supabase, user };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type ImportableCharacter = {
  name: string;
  server: string;
  className: string;
  itemLevel: number;
};

/** 로스트아크 API에서 불러온 캐릭터 중 선택한 것들을 내 캐릭터로 등록/갱신한다. */
export async function importCharacters(characters: ImportableCharacter[]) {
  const { supabase, user } = await requireUser();

  const rows = characters.map((c, i) => ({
    owner_id: user.id,
    name: c.name,
    server: c.server,
    class: c.className,
    item_level: c.itemLevel,
    sort_order: i,
  }));

  const { error } = await supabase
    .from("characters")
    .upsert(rows, { onConflict: "owner_id,name" });

  if (error) throw new Error(error.message);
  revalidatePath("/characters");
  revalidatePath("/");
}

export async function toggleGoldEarner(characterId: string, isGoldEarner: boolean) {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("characters")
    .update({ is_gold_earner: isGoldEarner })
    .eq("id", characterId);
  if (error) throw new Error(error.message);
  revalidatePath("/characters");
  revalidatePath("/");
}

export async function deleteCharacter(characterId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("characters").delete().eq("id", characterId);
  if (error) throw new Error(error.message);
  revalidatePath("/characters");
  revalidatePath("/");
}

export async function setRaidCheck(params: {
  characterId: string;
  raidId: string;
  gateNumber: number;
  checked: boolean;
}) {
  const { supabase, user } = await requireUser();
  const weekKey = getCurrentWeekKey();

  if (params.checked) {
    const { error } = await supabase.from("weekly_checks").upsert(
      {
        character_id: params.characterId,
        raid_id: params.raidId,
        gate_number: params.gateNumber,
        week_key: weekKey,
        checked_by: user.id,
      },
      { onConflict: "character_id,raid_id,gate_number,week_key" }
    );
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("weekly_checks")
      .delete()
      .eq("character_id", params.characterId)
      .eq("raid_id", params.raidId)
      .eq("gate_number", params.gateNumber)
      .eq("week_key", weekKey);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/");
}

export type RaidInput = {
  id?: string;
  name: string;
  difficulty: string;
  minItemLevel: number;
  goldPerGate: number[];
  isActive: boolean;
  sortOrder: number;
};

/** 레이드 목록은 신뢰된 친구 그룹 공용 데이터라 누구나 추가/수정할 수 있다. */
export async function upsertRaid(input: RaidInput) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("raids").upsert({
    id: input.id,
    name: input.name,
    difficulty: input.difficulty,
    min_item_level: input.minItemLevel,
    gate_count: input.goldPerGate.length,
    gold_per_gate: input.goldPerGate,
    is_active: input.isActive,
    sort_order: input.sortOrder,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/raids");
  revalidatePath("/");
}

export async function deleteRaid(raidId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("raids").delete().eq("id", raidId);
  if (error) throw new Error(error.message);
  revalidatePath("/raids");
  revalidatePath("/");
}
