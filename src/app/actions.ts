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
  revalidatePath("/party");
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
  revalidatePath("/party");
}

/** 대시보드에서 드래그로 정한 새 캐릭터 순서를 저장한다 (배열 순서 = sort_order). 내 캐릭터만 바꿀 수 있음. */
export async function reorderCharacters(characterIds: string[]) {
  const { supabase, user } = await requireUser();

  const results = await Promise.all(
    characterIds.map((id, index) =>
      supabase.from("characters").update({ sort_order: index }).eq("id", id).eq("owner_id", user.id)
    )
  );
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) throw new Error(firstError.message);

  revalidatePath("/characters");
  revalidatePath("/");
  revalidatePath("/party");
}

export type CombatPowerBulkResult = {
  characterId: string;
  combatPower: number | null;
  itemLevel: number | null;
  classEngraving: string | null;
}[];

/**
 * 로스트아크는 카오스던전 세팅과 레이드 세팅이 따로 있어서, API가 갱신되는 순간 카던 세팅 중이면
 * 전투력이 실제 레이드 전투력보다 낮게 잡힐 수 있다. 그래서 새로 받은 값이 기존 저장값보다 높을 때만 갱신한다
 * (한 번 기록된 "최고 전투력"은 낮은 스냅샷으로 덮어써지지 않음). 아이템 레벨도 같은 이유로 세팅에 따라
 * 순간적으로 낮게 잡힐 수 있어서 동일하게 "더 높을 때만 갱신" 규칙을 적용한다. 직업 각인도 그 순간의 값을
 * 함께 저장해서, "최고 전투력을 기록했을 때의 각인" 기준으로 서포터/딜러가 표시되도록 한다. 내 캐릭터
 * 전체를 한 번에 처리한다.
 */
export async function refreshAllCombatPower(): Promise<CombatPowerBulkResult> {
  const { supabase, user } = await requireUser();

  const { data: myCharacters, error: fetchError } = await supabase
    .from("characters")
    .select("id, name, combat_power, item_level, class_engraving")
    .eq("owner_id", user.id);
  if (fetchError) throw new Error(fetchError.message);

  const results = await Promise.all(
    (myCharacters ?? []).map(async (character) => {
      const [{ combatPower: fresh, itemLevel: freshItemLevel }, freshEngraving] = await Promise.all([
        fetchCombatPower(character.name),
        fetchClassEngraving(character.name),
      ]);
      const shouldUpdate = fresh !== null && (character.combat_power === null || fresh > character.combat_power);
      const shouldUpdateItemLevel =
        freshItemLevel !== null && (character.item_level === null || freshItemLevel > character.item_level);
      // class_engraving을 한 번도 기록한 적 없는 캐릭터는(마이그레이션 전에 등록됐던 경우 등),
      // 전투력이 신기록이 아니어도 지금 값으로 최초 한 번은 채워준다 (그러지 않으면 영영 표시가 안 됨).
      const shouldBackfillEngraving = character.class_engraving === null && freshEngraving !== null;
      if (shouldUpdate || shouldUpdateItemLevel || shouldBackfillEngraving) {
        const { error } = await supabase
          .from("characters")
          .update({
            ...(shouldUpdate ? { combat_power: fresh } : {}),
            ...(shouldUpdateItemLevel ? { item_level: freshItemLevel } : {}),
            class_engraving: freshEngraving,
          })
          .eq("id", character.id);
        if (error) throw new Error(error.message);
      }
      return {
        characterId: character.id,
        combatPower: shouldUpdate ? fresh : character.combat_power,
        itemLevel: shouldUpdateItemLevel ? freshItemLevel : character.item_level,
        classEngraving: shouldUpdate || shouldBackfillEngraving ? freshEngraving : character.class_engraving,
      };
    })
  );

  revalidatePath("/characters");
  revalidatePath("/");
  revalidatePath("/party");
  return results;
}

/** 실제로 장비를 빼거나 스펙이 다운된 경우, 예전에 기록된 "최고 전투력"/"최고 아이템 레벨"이 더 이상
 *  맞지 않을 수 있어서 최댓값 비교 없이 내 캐릭터 전체를 현재 API 값(전투력+아이템 레벨+직업 각인)으로
 *  강제로 덮어쓴다. */
export async function resetAllCombatPower(): Promise<CombatPowerBulkResult> {
  const { supabase, user } = await requireUser();

  const { data: myCharacters, error: fetchError } = await supabase
    .from("characters")
    .select("id, name")
    .eq("owner_id", user.id);
  if (fetchError) throw new Error(fetchError.message);

  const results = await Promise.all(
    (myCharacters ?? []).map(async (character) => {
      const [{ combatPower: fresh, itemLevel: freshItemLevel }, freshEngraving] = await Promise.all([
        fetchCombatPower(character.name),
        fetchClassEngraving(character.name),
      ]);
      const { error } = await supabase
        .from("characters")
        .update({ combat_power: fresh, item_level: freshItemLevel, class_engraving: freshEngraving })
        .eq("id", character.id);
      if (error) throw new Error(error.message);
      return { characterId: character.id, combatPower: fresh, itemLevel: freshItemLevel, classEngraving: freshEngraving };
    })
  );

  revalidatePath("/characters");
  revalidatePath("/");
  revalidatePath("/party");
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
  revalidatePath("/party");
}

export async function deleteCharacter(characterId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("characters").delete().eq("id", characterId);
  if (error) throw new Error(error.message);
  revalidatePath("/characters");
  revalidatePath("/");
  revalidatePath("/party");
}

/**
 * revalidatePath를 일부러 안 쓴다 — 대시보드/공격대는 weekly_checks 변경을 Supabase Realtime 구독으로
 * 이미 실시간 반영하고 있어서(Dashboard.tsx) 굳이 필요 없고, 참여현황 패널 스캔처럼 짧은 시간에 이 액션이
 * 연달아 여러 번 호출되면(레이드 여러 개를 연속 인식) revalidatePath가 트리거하는 자동 재렌더가 서로
 * 겹치면서 가끔 렌더링이 깨지는 문제(React #441)가 있었음.
 */
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
}

export type CharacterRaidSelection = { raidId: string; goldEarning: boolean };

/** 캐릭터가 주간 숙제로 도는 레이드 목록(과 그중 골드를 받을 레이드)을 통째로 교체한다 (대시보드의 '숙제 편집'에서 사용).
 *  예전엔 기존 선택을 전부 delete하고 새로 insert했는데, 대부분 레이드는 그대로 유지된 채 한두 개만
 *  바뀌는 경우가 많아서(예: 골드 받기 체크만 바꿈) 안 바뀐 레이드까지 delete+insert가 다시 일어났다.
 *  Dashboard.tsx의 Realtime 구독은 이 delete/insert를 각각 이벤트로 받아서 characterRaidMap을 갱신하는데,
 *  네트워크 타이밍에 따라 "새로 넣은 것"의 insert 이벤트가 먼저 오고 "안 바뀐 걸 지운" delete 이벤트가
 *  뒤늦게 도착하면 그 delete 핸들러가 (character_id, raid_id)만 보고 지워버려서, 방금 저장한 화면에서
 *  안 바뀐 레이드가 잠깐(또는 다음 갱신 전까지 계속) 사라져 보이는 문제가 있었다. 이제 실제로 바뀐
 *  것만 delete하고 나머지는 upsert해서, 안 바뀐 레이드는 애초에 delete 이벤트 자체가 안 생기게 한다. */
export async function setCharacterRaids(characterId: string, selections: CharacterRaidSelection[]) {
  const { supabase } = await requireUser();

  const { data: existing, error: fetchError } = await supabase
    .from("character_raids")
    .select("raid_id")
    .eq("character_id", characterId);
  if (fetchError) throw new Error(fetchError.message);

  const nextRaidIds = new Set(selections.map((s) => s.raidId));
  const toDelete = (existing ?? []).map((r) => r.raid_id).filter((raidId) => !nextRaidIds.has(raidId));

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("character_raids")
      .delete()
      .eq("character_id", characterId)
      .in("raid_id", toDelete);
    if (deleteError) throw new Error(deleteError.message);
  }

  if (selections.length > 0) {
    const { error: upsertError } = await supabase.from("character_raids").upsert(
      selections.map((s) => ({
        character_id: characterId,
        raid_id: s.raidId,
        is_gold_earning: s.goldEarning,
      })),
      { onConflict: "character_id,raid_id" }
    );
    if (upsertError) throw new Error(upsertError.message);
  }

  revalidatePath("/");
  revalidatePath("/party");
}

export type TemplateType =
  | "clear_banner"
  | "result_screen"
  | "gate_checkmark"
  | "status_row"
  | "character_name"
  | "result_screen_ocr"
  | "participation_panel_ocr"
  | "party_top_name_ocr"
  | "clear_button_ocr";
export type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };

/** 화면공유로 캡처해서 잘라낸 영역을 Storage에 올린 뒤, 무슨 용도의 기준 이미지인지 DB에 기록한다.
 *  'status_row'는 난이도 무관 레이드 이름(raidLabel)과 "참여 완료" 배지의 상대 위치(badgeCrop)도 함께 저장하고,
 *  'character_name'은 어느 캐릭터의 이름표인지(characterId)를 저장한다. */
export async function saveRaidClearTemplate(params: {
  raidId: string | null;
  templateType: TemplateType;
  crop: CropPct;
  storagePath: string;
  raidLabel?: string | null;
  badgeCrop?: CropPct | null;
  characterId?: string | null;
}) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("raid_clear_templates").insert({
    raid_id: params.raidId,
    template_type: params.templateType,
    crop: params.crop,
    raid_label: params.raidLabel ?? null,
    badge_crop: params.badgeCrop ?? null,
    character_id: params.characterId ?? null,
    storage_path: params.storagePath,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/auto-detect");
  revalidatePath("/menu-detect");
}

export async function deleteRaidClearTemplate(templateId: string, storagePath: string) {
  const { supabase, user } = await requireUser();

  // Storage 삭제 정책은 로그인한 사람이면 누구나 지울 수 있게 열려 있는데(버킷 전체가 다 같이 쓰는
  // 공용 등록 이미지라서), DB 행 삭제는 만든 사람만 가능하게 되어 있다(raid_clear_templates_delete_own).
  // 예전엔 이 둘을 그냥 순서대로 호출해서, 남이 등록한 걸 지우려고 하면 스토리지 파일은 진짜로 지워지는데
  // DB 행 삭제는 RLS에 걸려 조용히 0행 삭제로 끝나버렸다(에러 없이). 그 결과 파일은 없는데 DB 행만 남아서
  // "미리보기 없음"으로 계속 보이는 더미 항목이 생겼다. 여기서 소유자인지 먼저 확인해서 아예 막는다.
  const { data: template, error: fetchError } = await supabase
    .from("raid_clear_templates")
    .select("created_by")
    .eq("id", templateId)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  if (template.created_by !== user.id) {
    throw new Error("본인이 등록한 기준 이미지만 삭제할 수 있어요.");
  }

  // DB 행을 먼저 지우고 스토리지 파일을 나중에 지운다 — 혹시 스토리지 삭제가 실패해도(네트워크 등)
  // 화면에 보이는 항목이 사라지지 않는 더미 행을 남기는 것보다, 안 쓰는 파일이 스토리지에 남는 쪽이 낫다.
  const { error } = await supabase.from("raid_clear_templates").delete().eq("id", templateId);
  if (error) throw new Error(error.message);

  const { error: storageError } = await supabase.storage
    .from("raid-clear-templates")
    .remove([storagePath]);
  if (storageError) throw new Error(storageError.message);

  revalidatePath("/auto-detect");
  revalidatePath("/menu-detect");
}

/** 본인이 등록한 기준 이미지를 "등록 예시"로 지정/해제한다 — 영역을 어떻게 잡아야 하는지 헷갈려하는
 *  친구들에게 참고용으로 보여주기 위함. raid_clear_templates는 전원이 읽을 수 있는 공용 테이블이라
 *  is_example만 true로 바꾸면 다른 사람 화면에도 바로 예시 갤러리로 노출된다. */
export async function setTemplateExample(templateId: string, isExample: boolean) {
  const { supabase, user } = await requireUser();

  const { data: template, error: fetchError } = await supabase
    .from("raid_clear_templates")
    .select("created_by")
    .eq("id", templateId)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  if (template.created_by !== user.id) {
    throw new Error("본인이 등록한 기준 이미지만 예시로 지정할 수 있어요.");
  }

  const { error } = await supabase
    .from("raid_clear_templates")
    .update({ is_example: isExample })
    .eq("id", templateId);
  if (error) throw new Error(error.message);

  revalidatePath("/auto-detect");
  revalidatePath("/menu-detect");
}
