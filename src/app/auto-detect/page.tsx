import { createClient } from "@/lib/supabase/server";
import ScreenCapture from "@/components/ScreenCapture";

export default async function AutoDetectPage() {
  const supabase = await createClient();

  const [{ data: raids }, { data: templates }] = await Promise.all([
    supabase.from("raids").select("id, name, difficulty, sort_order").eq("is_active", true).order("sort_order"),
    supabase
      .from("raid_clear_templates")
      .select("id, raid_id, template_type, crop, storage_path, created_at")
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
        화면공유 중 프레임을 캡처한 뒤, 실제로 필요한 부분만 드래그로 잘라서 기준 이미지로 저장해주세요.
        아직 자동으로 체크해주는 기능은 없고, 기준 이미지를 모으는 단계예요.
      </p>
      <ul className="mb-6 list-disc space-y-1 pl-5 text-xs text-neutral-500">
        <li>
          <strong>던전 클리어 배너</strong>: 관문 클리어 시 화면 가운데 뜨는 문구 부분만 잘라서 저장 (레이드 상관없이 공용)
        </li>
        <li>
          <strong>레이드 결과화면(레이드명)</strong>: 던전 종료 화면에서 레이드명·난이도 텍스트가 있는 부분만 잘라서 저장
          (레이드별로 하나씩)
        </li>
        <li>
          <strong>관문 체크마크</strong>: 관문이 파괴된 걸 나타내는 체크 아이콘 하나만 잘라서 저장 (공용)
        </li>
      </ul>
      <ScreenCapture raids={raids ?? []} initialTemplates={templatesWithUrls} />
    </main>
  );
}
