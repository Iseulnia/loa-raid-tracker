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
      .in("template_type", ["status_row", "character_name"])
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

  const statusRowTemplates = templatesWithUrls
    .filter((t) => t.template_type === "status_row" && t.url && t.crop && t.badge_crop && t.raid_label)
    .map((t) => ({ id: t.id, raidLabel: t.raid_label!, crop: t.crop!, badgeCrop: t.badge_crop!, url: t.url! }));

  // 캐릭터 이름 인식은 OCR이라 어떤 캐릭터든 그때그때 텍스트로 읽어서 매칭하므로, 저장된 크롭 위치(화면
  // 좌표)만 있으면 되고 특정 캐릭터에 종속되지 않는다. 대신 이 좌표는 "내가 화면공유한 화면"에서 캡처한
  // 것이라 다른 사람의 화면 배치/해상도와 다를 수 있으므로, 반드시 내가 등록한 것만 써야 한다
  // (raid_clear_templates는 RLS상 모든 로그인 사용자에게 보이는 테이블이라 다른 사람 것도 섞여 들어올 수 있음).
  const characterNameRegions = templatesWithUrls
    .filter((t) => t.template_type === "character_name" && t.crop && t.created_by === user.id)
    .map((t) => ({ id: t.id, crop: t.crop! }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">메뉴 감지 (베타)</h1>
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
          templates={statusRowTemplates}
          characterNameRegions={characterNameRegions}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">기준 이미지 관리</h2>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-neutral-500 dark:text-neutral-400">
          <li>
            <strong>레이드 참여현황 이름표</strong>: &ldquo;레이드 참여 현황&rdquo; 패널에서 레이드 이름 부분과 그
            옆 &ldquo;참여 완료&rdquo; 배지 부분을 순서대로 선택 (레이드 이름별로 하나씩, 난이도 구분 없음)
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
          allowedTypes={["status_row", "character_name"]}
        />
      </section>
    </main>
  );
}
