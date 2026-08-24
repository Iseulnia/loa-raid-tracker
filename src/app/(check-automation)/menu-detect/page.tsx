import { createClient } from "@/lib/supabase/server";
import ScreenCapture from "@/components/ScreenCapture";
import StatusPanelScanner from "@/components/StatusPanelScanner";

export default async function MenuDetectPage() {
  const supabase = await createClient();
  // middleware가 이미 getUser()로 세션을 검증한 뒤에만 여기 도달하므로, 여기서는 네트워크 호출 없는
  // getSession()으로 충분함(탭 이동마다 인증 확인이 중복으로 여러 번 일어나던 걸 줄이기 위함).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return null;

  const [{ data: raids }, { data: templates }, { data: characters }, { data: characterRaids }] = await Promise.all([
    supabase.from("raids").select("id, name, difficulty, sort_order").eq("is_active", true).order("sort_order"),
    supabase
      .from("raid_clear_templates")
      .select("id, raid_id, template_type, crop, raid_label, badge_crop, character_id, storage_path, created_by, created_at")
      .in("template_type", ["status_row", "character_name", "participation_panel_ocr"])
      // 다른 사람 화면 배치/해상도가 달라서 어차피 본인이 등록한 것만 실제로 쓰이는데, 예전엔 친구들
      // 것까지 다 가져와서 "기준 영역 등록" 목록에 섞여 보여 헷갈린다는 피드백을 받고 아예 본인 것만
      // 가져오도록 바꿈.
      .eq("created_by", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("characters").select("id, name, item_level").eq("owner_id", user.id).order("item_level", { ascending: false }),
    supabase.from("character_raids").select("character_id, raid_id"),
  ]);

  // 템플릿마다 서명 URL을 따로 요청하지 않고 한 번에 묶어서 요청한다(등록된 기준 영역이 여러 개일 때
  // 요청 수를 템플릿 개수만큼이 아니라 1번으로 줄임).
  const templatePaths = (templates ?? []).map((t) => t.storage_path);
  const { data: signedUrls } =
    templatePaths.length > 0
      ? await supabase.storage.from("raid-clear-templates").createSignedUrls(templatePaths, 600)
      : { data: null };
  const urlByPath = new Map((signedUrls ?? []).map((s) => [s.path, s.signedUrl]));
  const templatesWithUrls = (templates ?? []).map((t) => ({ ...t, url: urlByPath.get(t.storage_path) ?? null }));

  // 위치가 고정인 영역들은(패널 전체, 캐릭터 이름) 내가 등록한 것만 쓴다 — 위 쿼리에서 이미 본인 것만
  // 가져왔다.
  const panelRegion = templatesWithUrls.find((t) => t.template_type === "participation_panel_ocr" && t.crop)?.crop ?? null;

  const characterNameRegions = templatesWithUrls
    .filter((t) => t.template_type === "character_name" && t.crop)
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
          currentUserId={user.id}
        />
      </section>
    </div>
  );
}
