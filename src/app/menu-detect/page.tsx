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
      .select("id, raid_id, template_type, crop, raid_label, badge_crop, character_id, storage_path, created_at")
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

  // raid_clear_templates는 RLS상 모든 로그인 사용자에게 보이므로(다른 친구가 등록한 것도 포함),
  // 캐릭터 이름표는 반드시 "내 캐릭터"로만 한정해야 한다 — 안 그러면 다른 사람 캐릭터로 잘못 인식돼서
  // setRaidCheck이 그 캐릭터 소유자가 아니라는 이유로(RLS) 계속 실패하는 문제가 생김.
  const myCharacterIds = new Set((characters ?? []).map((c) => c.id));
  const characterNameTemplates = templatesWithUrls
    .filter(
      (t) => t.template_type === "character_name" && t.url && t.crop && t.character_id && myCharacterIds.has(t.character_id)
    )
    .map((t) => ({ id: t.id, characterId: t.character_id!, crop: t.crop!, url: t.url! }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">메뉴 감지 (베타)</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        로아 메뉴의 &ldquo;레이드 참여 현황&rdquo; 패널(참여 가능/참여 완료 표시되는 목록)을 켜둔 상태로 스캔을
        시작하고, 목록을 천천히 스크롤해서 지나가면 클리어된 레이드가 자동으로 인식·체크됩니다. &ldquo;자동
        감지&rdquo; 탭과 달리 계속 켜두는 게 아니라, 확인할 때만 스캔을 켰다가 끄는 방식이라 평소엔 렉 부담이
        없어요. 화면 좌측 하단의 캐릭터 이름표도 등록해두면 캐릭터를 직접 고르지 않아도 자동으로 인식돼요.
      </p>

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">참여현황 패널 스캔</h2>
        <StatusPanelScanner
          characters={characters ?? []}
          raids={raids ?? []}
          characterRaids={characterRaids ?? []}
          templates={statusRowTemplates}
          characterNameTemplates={characterNameTemplates}
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
            <strong>캐릭터 이름표</strong>: 게임 메뉴 화면 좌측 하단에 고정으로 뜨는 캐릭터 이름 부분을 선택
            (캐릭터별로 하나씩 — 등록해두면 스캔할 때 캐릭터를 직접 고르지 않아도 자동으로 인식돼요)
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
