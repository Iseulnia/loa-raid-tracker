import { createClient } from "@/lib/supabase/server";
import ScreenCapture from "@/components/ScreenCapture";

export default async function AutoDetectPage() {
  const supabase = await createClient();

  const [{ data: raids }, { data: templates }] = await Promise.all([
    supabase.from("raids").select("id, name, difficulty, sort_order").eq("is_active", true).order("sort_order"),
    supabase
      .from("raid_clear_templates")
      .select("id, raid_id, storage_path, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const templatesWithUrls = await Promise.all(
    (templates ?? []).map(async (t) => {
      const { data } = await supabase.storage.from("raid-clear-templates").createSignedUrl(t.storage_path, 600);
      return { ...t, url: data?.signedUrl ?? null };
    })
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">자동 감지 (베타 · 1단계)</h1>
      <p className="mb-6 text-sm text-neutral-500">
        화면공유로 게임 화면을 공유하고, 실제로 레이드를 클리어한 순간 그 화면을 기준 이미지로 저장해주세요.
        아직 자동으로 체크해주는 기능은 없고, 기준 이미지를 모으는 단계예요. 레이드마다 몇 장씩 모이면 그다음
        단계(자동 비교/체크)를 이어서 만들 수 있어요.
      </p>
      <ScreenCapture raids={raids ?? []} initialTemplates={templatesWithUrls} />
    </main>
  );
}
