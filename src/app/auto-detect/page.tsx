import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekKey } from "@/lib/week";
import ScreenCapture from "@/components/ScreenCapture";
import AutoDetectRunner from "@/components/AutoDetectRunner";
import StatusPanelScanner from "@/components/StatusPanelScanner";

export default async function AutoDetectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const weekKey = getCurrentWeekKey();

  const [{ data: raids }, { data: templates }, { data: characters }, { data: checks }, { data: characterRaids }] =
    await Promise.all([
      supabase.from("raids").select("id, name, difficulty, sort_order").eq("is_active", true).order("sort_order"),
      supabase
        .from("raid_clear_templates")
        .select("id, raid_id, template_type, crop, raid_label, badge_crop, storage_path, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("characters").select("id, name, item_level").eq("owner_id", user.id).order("item_level", { ascending: false }),
      supabase.from("weekly_checks").select("character_id, raid_id").eq("week_key", weekKey),
      supabase.from("character_raids").select("character_id, raid_id"),
    ]);

  const templatesWithUrls = await Promise.all(
    (templates ?? []).map(async (t) => {
      const { data } = await supabase.storage.from("raid-clear-templates").createSignedUrl(t.storage_path, 600);
      return { ...t, url: data?.signedUrl ?? null };
    })
  );

  const resultScreenTemplates = templatesWithUrls.filter((t) => t.template_type === "result_screen" && t.url && t.crop);
  const statusRowTemplates = templatesWithUrls
    .filter((t) => t.template_type === "status_row" && t.url && t.crop && t.badge_crop && t.raid_label)
    .map((t) => ({ id: t.id, raidLabel: t.raid_label!, crop: t.crop!, badgeCrop: t.badge_crop!, url: t.url! }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">자동 감지 (베타)</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        화면공유로 라이브 화면을 저장된 결과화면 기준 이미지들과 계속 비교해서, 일치하는 게 있으면 그 레이드를
        자동으로 체크합니다. 오탐이 있을 수 있어서 자동 체크된 항목은 언제든 바로 취소할 수 있어요.
      </p>

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">자동 감지 실행</h2>
        <AutoDetectRunner
          characters={characters ?? []}
          resultScreenTemplates={resultScreenTemplates}
          raids={raids ?? []}
          initialChecks={checks ?? []}
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">참여현황 패널 스캔</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          로아 메뉴의 &ldquo;레이드 참여 현황&rdquo; 패널(참여 가능/참여 완료 표시되는 목록)을 켜둔 상태로 스캔을
          시작하고, 목록을 천천히 스크롤해서 지나가면 클리어된 레이드가 자동으로 인식·체크됩니다. 위쪽 결과화면
          자동감지와 달리 계속 켜두는 게 아니라, 확인할 때만 켰다가 끄는 방식이라 평소엔 렉 부담이 없어요.
        </p>
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
          레이드가 새로 추가되거나 인식이 잘 안 될 때 여기서 기준 이미지를 더 모아주세요.
        </p>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-neutral-500 dark:text-neutral-400">
          <li>
            <strong>던전 클리어 배너</strong>: 관문 클리어 시 화면 가운데 뜨는 문구 부분만 (레이드 공용, 참고용 표시에만 사용)
          </li>
          <li>
            <strong>레이드 결과화면</strong>: 던전 종료 화면에서 레이드명·난이도·체크마크가 보이는 부분을 넉넉히
            (레이드·난이도별로 하나씩 — 실제 자동 감지는 이 템플릿으로 이루어져요)
          </li>
          <li>
            <strong>레이드 참여현황 이름표</strong>: &ldquo;레이드 참여 현황&rdquo; 패널에서 레이드 이름 부분과 그 옆
            &ldquo;참여 완료&rdquo; 배지 부분을 순서대로 선택 (레이드 이름별로 하나씩, 난이도 구분 없음 — 위
            &ldquo;참여현황 패널 스캔&rdquo;은 이 템플릿으로 이루어져요)
          </li>
        </ul>
        <ScreenCapture raids={raids ?? []} initialTemplates={templatesWithUrls} />
      </section>
    </main>
  );
}
