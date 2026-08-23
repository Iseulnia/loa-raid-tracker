import { createClient } from "@/lib/supabase/server";
import ScreenCapture from "@/components/ScreenCapture";
import StatusPanelScanner from "@/components/StatusPanelScanner";

export default async function MenuDetectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: raids }, { data: templates }, { data: characters }, { data: characterRaids }] = await Promise.all([
    supabase.from("raids").select("id, name, difficulty, sort_order").eq("is_active", true).order("sort_order"),
    supabase
      .from("raid_clear_templates")
      .select("id, raid_id, template_type, crop, raid_label, badge_crop, character_id, storage_path, created_by, created_at")
      .in("template_type", ["status_row", "character_name", "participation_panel_ocr"])
      .order("created_at", { ascending: false }),
    supabase.from("characters").select("id, name, item_level").eq("owner_id", user.id).order("item_level", { ascending: false }),
    supabase.from("character_raids").select("character_id, raid_id"),
  ]);

  const templatesWithUrls = await Promise.all(
    (templates ?? []).map(async (t) => {
      const { data } = await supabase.storage.from("raid-clear-templates").createSignedUrl(t.storage_path, 600);
      return { ...t, url: data?.signedUrl ?? null };
    })
  );

  // 위치가 고정인 영역들은(패널 전체, 캐릭터 이름) 내가 등록한 것만 쓴다 — 다른 사람 화면 배치/해상도가
  // 다를 수 있어서다 (raid_clear_templates는 RLS상 다른 사람 것도 보이는 테이블이라서).
  const panelRegion = templatesWithUrls.find((t) => t.template_type === "participation_panel_ocr" && t.crop && t.created_by === user.id)?.crop ?? null;

  const characterNameRegions = templatesWithUrls
    .filter((t) => t.template_type === "character_name" && t.crop && t.created_by === user.id)
    .map((t) => ({ id: t.id, crop: t.crop! }));

  return (
    <div className="pb-6">
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        로아 메뉴의 &ldquo;레이드 참여 현황&rdquo; 패널(참여 가능/참여 완료 표시되는 목록)을 켜둔 상태로 스캔을
        시작하고, 목록을 천천히 스크롤해서 지나가면 클리어된 레이드가 자동으로 인식·체크됩니다. &ldquo;자동
        감지&rdquo; 탭과 달리 계속 켜두는 게 아니라, 확인할 때만 스캔을 켰다가 끄는 방식이라 평소엔 렉 부담이
        없어요. 화면 좌측 하단의 캐릭터 이름이 뜨는 자리를 한 번만 등록해두면, 그 자리 글자를 OCR로 읽어서
        어떤 캐릭터든 자동으로 인식돼요 (캐릭터마다 따로 등록할 필요 없음).
      </p>

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">참여현황 패널 스캔</h2>
        <StatusPanelScanner
          characters={characters ?? []}
          raids={raids ?? []}
          characterRaids={characterRaids ?? []}
          panelRegion={panelRegion}
          characterNameRegions={characterNameRegions}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">기준 영역 등록</h2>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-neutral-500 dark:text-neutral-400">
          <li>
            <strong>레이드 참여현황 패널 인식 영역</strong>: &ldquo;레이드 참여 현황&rdquo; 패널에서 레이드 목록이
            보이는 영역 전체를 넉넉하게 선택 (한 번만 등록하면 됨 — OCR로 그 안의 레이드명과 참여 완료 여부를
            한꺼번에 읽어요)
          </li>
          <li>
            <strong>캐릭터 이름 인식 영역</strong>: 게임 메뉴 화면 좌측 하단에 고정으로 뜨는 캐릭터 이름 부분을
            선택 (한 번만 등록하면 됨 — OCR로 그 자리 글자를 읽어서 어떤 캐릭터든 자동으로 인식해요)
          </li>
        </ul>
        <ScreenCapture
          raids={raids ?? []}
          characters={characters ?? []}
          initialTemplates={templatesWithUrls}
          allowedTypes={["participation_panel_ocr", "character_name"]}
        />
      </section>
    </div>
  );
}
