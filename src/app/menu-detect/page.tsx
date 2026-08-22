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
      .select("id, raid_id, template_type, crop, raid_label, badge_crop, storage_path, created_at")
      .eq("template_type", "status_row")
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
    .filter((t) => t.url && t.crop && t.badge_crop && t.raid_label)
    .map((t) => ({ id: t.id, raidLabel: t.raid_label!, crop: t.crop!, badgeCrop: t.badge_crop!, url: t.url! }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">메뉴 감지 (베타)</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        로아 메뉴의 &ldquo;레이드 참여 현황&rdquo; 패널(참여 가능/참여 완료 표시되는 목록)을 켜둔 상태로 스캔을
        시작하고, 목록을 천천히 스크롤해서 지나가면 클리어된 레이드가 자동으로 인식·체크됩니다. &ldquo;자동
        감지&rdquo; 탭과 달리 계속 켜두는 게 아니라, 확인할 때만 스캔을 켰다가 끄는 방식이라 평소엔 렉 부담이
        없어요.
      </p>

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">참여현황 패널 스캔</h2>
        <StatusPanelScanner
          characters={characters ?? []}
          raids={raids ?? []}
          characterRaids={characterRaids ?? []}
          templates={statusRowTemplates}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">기준 이미지 관리</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          &ldquo;레이드 참여 현황&rdquo; 패널에서 레이드 이름 부분과 그 옆 &ldquo;참여 완료&rdquo; 배지 부분을
          순서대로 선택해서 등록하세요 (레이드 이름별로 하나씩, 난이도 구분 없음).
        </p>
        <ScreenCapture raids={raids ?? []} initialTemplates={templatesWithUrls} allowedTypes={["status_row"]} />
      </section>
    </main>
  );
}
