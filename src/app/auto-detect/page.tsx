import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekKey } from "@/lib/week";
import ScreenCapture from "@/components/ScreenCapture";
import AutoDetectRunner from "@/components/AutoDetectRunner";

export default async function AutoDetectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const weekKey = getCurrentWeekKey();

  const [{ data: raids }, { data: templates }, { data: characters }, { data: checks }] = await Promise.all([
    supabase.from("raids").select("id, name, difficulty, sort_order").eq("is_active", true).order("sort_order"),
    supabase
      .from("raid_clear_templates")
      .select("id, raid_id, template_type, crop, raid_label, badge_crop, character_id, storage_path, created_at")
      .neq("template_type", "status_row") // status_row 템플릿은 '메뉴 감지' 탭 전용이라 여기엔 안 보여줌
      .order("created_at", { ascending: false }),
    supabase.from("characters").select("id, name, item_level").eq("owner_id", user.id).order("item_level", { ascending: false }),
    supabase.from("weekly_checks").select("character_id, raid_id").eq("week_key", weekKey),
  ]);

  const templatesWithUrls = await Promise.all(
    (templates ?? []).map(async (t) => {
      const { data } = await supabase.storage.from("raid-clear-templates").createSignedUrl(t.storage_path, 600);
      return { ...t, url: data?.signedUrl ?? null };
    })
  );

  const resultScreenTemplates = templatesWithUrls.filter((t) => t.template_type === "result_screen" && t.url && t.crop);

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
        </ul>
        <ScreenCapture raids={raids ?? []} initialTemplates={templatesWithUrls} allowedTypes={["clear_banner", "result_screen", "gate_checkmark"]} />
      </section>
    </main>
  );
}
