"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekKey } from "@/lib/week";
import { fetchCombatPower, fetchClassEngraving } from "@/lib/lostark";

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
  combatPower: number | null;
  classEngraving: string | null;
};

/** 로스트아크 API에서 불러온 캐릭터 중 선택한 것들을 내 캐릭터로 등록/갱신한다.
 *  expeditionLabel을 넣으면 이 배치로 불러온 캐릭터들이 같은 원정대(계정)로 묶인다. */
export async function importCharacters(characters: ImportableCharacter[], expeditionLabel: string | null) {
  const { supabase, user } = await requireUser();

  const rows = characters.map((c, i) => ({
    owner_id: user.id,
    name: c.name,
    server: c.server,
    class: c.className,
    item_level: c.itemLevel,
    combat_power: c.combatPower,
    class_engraving: c.classEngraving,
    expedition_label: expeditionLabel,
    sort_order: i,
  }));

  const { error } = await supabase
    .from("characters")
    .upsert(rows, { onConflict: "owner_id,name" });

  if (error) throw new Error(error.message);
  revalidatePath("/characters");
  revalidatePath("/");
}

/** 같은 원정대(expedition_label) 안에서 이 캐릭터만 대표 캐릭터로 지정하고 나머지는 해제한다. */
export async function setMainCharacter(characterId: string) {
  const { supabase, user } = await requireUser();

  const { data: character, error: fetchError } = await supabase
    .from("characters")
    .select("expedition_label")
    .eq("id", characterId)
    .single();
  if (fetchError || !character) throw new Error(fetchError?.message ?? "캐릭터를 찾을 수 없어요.");

  let unsetQuery = supabase.from("characters").update({ is_main_character: false }).eq("owner_id", user.id);
  unsetQuery =
    character.expedition_label === null
      ? unsetQuery.is("expedition_label", null)
      : unsetQuery.eq("expedition_label", character.expedition_label);
  const { error: unsetError } = await unsetQuery;
  if (unsetError) throw new Error(unsetError.message);

  const { error } = await supabase.from("characters").update({ is_main_character: true }).eq("id", characterId);
  if (error) throw new Error(error.message);

  revalidatePath("/characters");
  revalidatePath("/");
}

export type CombatPowerBulkResult = { characterId: string; combatPower: number | null; classEngraving: string | null }[];

/**
 * 로스트아크는 카오스던전 세팅과 레이드 세팅이 따로 있어서, API가 갱신되는 순간 카던 세팅 중이면
 * 전투력이 실제 레이드 전투력보다 낮게 잡힐 수 있다. 그래서 새로 받은 값이 기존 저장값보다 높을 때만 갱신한다
 * (한 번 기록된 "최고 전투력"은 낮은 스냅샷으로 덮어써지지 않음). 직업 각인도 그 순간의 값을 함께 저장해서,
 * "최고 전투력을 기록했을 때의 각인" 기준으로 서포터/딜러가 표시되도록 한다. 내 캐릭터 전체를 한 번에 처리한다.
 */
export async function refreshAllCombatPower(): Promise<CombatPowerBulkResult> {
  const { supabase, user } = await requireUser();

  const { data: myCharacters, error: fetchError } = await supabase
    .from("characters")
    .select("id, name, combat_power, class_engraving")
    .eq("owner_id", user.id);
  if (fetchError) throw new Error(fetchError.message);

  const results = await Promise.all(
    (myCharacters ?? []).map(async (character) => {
      const [fresh, freshEngraving] = await Promise.all([
        fetchCombatPower(character.name),
        fetchClassEngraving(character.name),
      ]);
      const shouldUpdate = fresh !== null && (character.combat_power === null || fresh > character.combat_power);
      // class_engraving을 한 번도 기록한 적 없는 캐릭터는(마이그레이션 전에 등록됐던 경우 등),
      // 전투력이 신기록이 아니어도 지금 값으로 최초 한 번은 채워준다 (그러지 않으면 영영 표시가 안 됨).
      const shouldBackfillEngraving = character.class_engraving === null && freshEngraving !== null;
      if (shouldUpdate || shouldBackfillEngraving) {
        const { error } = await supabase
          .from("characters")
          .update({
            ...(shouldUpdate ? { combat_power: fresh } : {}),
            class_engraving: freshEngraving,
          })
          .eq("id", character.id);
        if (error) throw new Error(error.message);
      }
      return {
        characterId: character.id,
        combatPower: shouldUpdate ? fresh : character.combat_power,
        classEngraving: shouldUpdate || shouldBackfillEngraving ? freshEngraving : character.class_engraving,
      };
    })
  );

  revalidatePath("/characters");
  revalidatePath("/");
  return results;
}

/** 실제로 장비를 빼거나 스펙이 다운된 경우, 예전에 기록된 "최고 전투력"이 더 이상 맞지 않을 수 있어서
 *  최댓값 비교 없이 내 캐릭터 전체를 현재 API 값(전투력+직업 각인)으로 강제로 덮어쓴다. */
export async function resetAllCombatPower(): Promise<CombatPowerBulkResult> {
  const { supabase, user } = await requireUser();

  const { data: myCharacters, error: fetchError } = await supabase
    .from("characters")
    .select("id, name")
    .eq("owner_id", user.id);
  if (fetchError) throw new Error(fetchError.message);

  const results = await Promise.all(
    (myCharacters ?? []).map(async (character) => {
      const [fresh, freshEngraving] = await Promise.all([
        fetchCombatPower(character.name),
        fetchClassEngraving(character.name),
      ]);
      const { error } = await supabase
        .from("characters")
        .update({ combat_power: fresh, class_engraving: freshEngraving })
        .eq("id", character.id);
      if (error) throw new Error(error.message);
      return { characterId: character.id, combatPower: fresh, classEngraving: freshEngraving };
    })
  );

  revalidatePath("/characters");
  revalidatePath("/");
  return results;
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

export type CharacterRaidSelection = { raidId: string; goldEarning: boolean };

/** 캐릭터가 주간 숙제로 도는 레이드 목록(과 그중 골드를 받을 레이드)을 통째로 교체한다 (대시보드의 '숙제 편집'에서 사용). */
export async function setCharacterRaids(characterId: string, selections: CharacterRaidSelection[]) {
  const { supabase } = await requireUser();

  const { error: deleteError } = await supabase
    .from("character_raids")
    .delete()
    .eq("character_id", characterId);
  if (deleteError) throw new Error(deleteError.message);

  if (selections.length > 0) {
    const { error: insertError } = await supabase.from("character_raids").insert(
      selections.map((s) => ({
        character_id: characterId,
        raid_id: s.raidId,
        is_gold_earning: s.goldEarning,
      }))
    );
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath("/");
}

export type TemplateType = "clear_banner" | "result_screen" | "gate_checkmark";
export type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };

/** 화면공유로 캡처해서 잘라낸 영역을 Storage에 올린 뒤, 무슨 용도의 기준 이미지인지 DB에 기록한다. */
export async function saveRaidClearTemplate(params: {
  raidId: string | null;
  templateType: TemplateType;
  crop: CropPct;
  storagePath: string;
}) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("raid_clear_templates").insert({
    raid_id: params.raidId,
    template_type: params.templateType,
    crop: params.crop,
    storage_path: params.storagePath,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/auto-detect");
}

export async function deleteRaidClearTemplate(templateId: string, storagePath: string) {
  const { supabase } = await requireUser();
  const { error: storageError } = await supabase.storage
    .from("raid-clear-templates")
    .remove([storagePath]);
  if (storageError) throw new Error(storageError.message);

  const { error } = await supabase.from("raid_clear_templates").delete().eq("id", templateId);
  if (error) throw new Error(error.message);
  revalidatePath("/auto-detect");
}
