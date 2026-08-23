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
      .select("id, raid_id, template_type, crop, raid_label, badge_crop, character_id, storage_path, created_by, created_at")
      .in("template_type", ["result_screen_ocr", "party_top_name_ocr", "clear_button_ocr"])
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

  // 위치가 고정이라(스크롤 없음) 내가 등록한 것 하나만 있으면 됨 — 다른 사람 화면 배치/해상도가 다를 수
  // 있어서 반드시 내가 등록한 것만 쓴다 (raid_clear_templates는 RLS상 다른 사람 것도 보이는 테이블이라서).
  const resultScreenOcrRegion =
    templatesWithUrls.find((t) => t.template_type === "result_screen_ocr" && t.crop && t.created_by === user.id)?.crop ?? null;
  // 레이드 중 화면 우측 파티원 목록 맨 위(항상 내 캐릭터)를 읽어서 캐릭터를 직접 안 골라도 자동으로 따라가게
  // 함(선택 사항 — 등록 안 해도 기존처럼 드롭다운으로 직접 고르면 됨).
  const partyTopNameRegion =
    templatesWithUrls.find((t) => t.template_type === "party_top_name_ocr" && t.crop && t.created_by === user.id)?.crop ?? null;
  // "나가기" 버튼 텍스트만 따로 좁게 등록한 영역(선택 사항) — 있으면 이걸로 클리어 판정을 하고, 없으면
  // AutoDetectRunner가 결과화면 영역 텍스트 안에서 "나가기"를 같이 찾는 예전 방식으로 대체함(하위 호환).
  const clearButtonOcrRegion =
    templatesWithUrls.find((t) => t.template_type === "clear_button_ocr" && t.crop && t.created_by === user.id)?.crop ?? null;

  return (
    <div className="pb-6">
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        화면공유로 라이브 화면을 보면서, 관문 제목 표시줄의 레이드명+난이도와 하단 버튼이 &ldquo;나가기&rdquo;로
        바뀐 것을 OCR로 함께 읽어서 클리어된 레이드를 자동으로 인식·체크합니다(레이드명+난이도는 입장 직후부터
        항상 떠 있어서, 나가기 버튼까지 같이 읽혀야 클리어로 인정해요). 오탐이 있을 수 있어서 자동 체크된
        항목은 언제든 바로 취소할 수 있어요.
      </p>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        결과화면 영역에 체크마크 아이콘과 나가기 버튼까지 같이 들어가면 그 그래픽 때문에 OCR 글자가 깨지기
        쉬워서, 나가기 버튼 텍스트는 별도 영역으로 좁게 따로 등록하는 걸 추천해요(선택 사항이지만 정확도가
        많이 올라가요).
      </p>

      <section className="mb-10">
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">자동 감지 실행</h2>
        <AutoDetectRunner
          characters={characters ?? []}
          resultScreenOcrRegion={resultScreenOcrRegion}
          clearButtonOcrRegion={clearButtonOcrRegion}
          characterNameRegion={partyTopNameRegion}
          raids={raids ?? []}
          initialChecks={checks ?? []}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">기준 영역 등록</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          관문 제목 표시줄에서 레이드명·난이도 텍스트만 딱 감싸서(체크마크·버튼은 빼고) 등록해두면 모든
          레이드에 재사용돼요. 위치는 화면마다 항상 같은 자리라 다시 등록할 필요 없어요.{" "}
          <strong>레이드별로 여러 개 등록할 필요 없이 딱 하나만 있으면 되고, 여러 개 등록해도 가장 최근
          것 하나만 실제로 쓰여요.</strong> 클리어하면 &ldquo;나가기&rdquo;로 바뀌는 버튼 글자 부분도 따로
          좁게 등록해두면(체크마크·테두리는 빼고) 클리어 판정 정확도가 올라가요(선택 사항). 레이드 중 화면
          우측 파티원 목록 맨 위(항상 내 캐릭터) 이름 위치도 등록해두면 캐릭터를 매번 직접 고르지 않아도
          자동으로 인식돼요(선택 사항).
        </p>
        <ScreenCapture
          raids={raids ?? []}
          initialTemplates={templatesWithUrls}
          allowedTypes={["result_screen_ocr", "clear_button_ocr", "party_top_name_ocr"]}
        />
      </section>
    </div>
  );
}
