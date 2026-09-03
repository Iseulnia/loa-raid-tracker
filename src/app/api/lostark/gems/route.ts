import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LostArkApiError } from "@/lib/lostark";
import { refreshGemPriceSnapshots } from "@/lib/gemPrices";

// 하루 평균/전일 대비/7일 추이를 계산하려면 적어도 지난 8일치가 있어야 "오늘 vs 어제"까지 계산할 수 있다.
const HISTORY_DAYS = 8;

// Supabase(PostgREST)는 한 번의 조회에서 최대 1,000행까지만 돌려준다. 자동 갱신(pg_cron 매시간 + GitHub
// Actions)이 제대로 돌기 시작하면서 8일치 스냅샷이 하루 ~174행씩 쌓여 그 한도를 넘어섰고, 오래된 순으로
// 정렬해 한 번에 가져오다 보니 "오래된 1,000행"만 오고 최신 기록이 통째로 잘려나갔다 — 자동 갱신은 잘
// 되는데 화면의 "마지막 갱신"만 며칠 전에 멈춰 보이던 원인. 한도에 안 걸리게 페이지를 나눠서 전부 가져온다.
const PAGE_SIZE = 1000;
const MAX_PAGES = 20; // 8일치가 이 한도(2만 행)를 넘을 일은 없음 — 혹시 모를 무한 루프 방지용

type SnapshotRow = { gem_key: string; price: number; recorded_at: string };

async function fetchSnapshotsSince(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string
): Promise<SnapshotRow[]> {
  const all: SnapshotRow[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("gem_price_snapshots")
      .select("gem_key, price, recorded_at")
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const batch = (data ?? []) as SnapshotRow[];
    all.push(...batch);
    // 서버가 요청한 것보다 적게 주는 경우(한도 설정이 1,000보다 작을 때)에도 실제 받은 개수만큼만
    // 건너뛰어야 빠지는 행이 없다. 빈 배열이 오면 더 없는 것이므로 종료.
    if (batch.length === 0) break;
    from += batch.length;
  }
  return all;
}

// 저장된 시세 기록만 읽는다(외부 API 호출 없음) — 페이지 열 때마다 자동으로 불러도 부담 없음.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const snapshots = await fetchSnapshotsSince(supabase, since);
    return NextResponse.json({ snapshots });
  } catch (err) {
    console.error("[lostark/gems] db read failed:", err);
    return NextResponse.json({ error: "저장된 시세를 불러오지 못했어요." }, { status: 500 });
  }
}

// 경매장에서 6종 보석의 현재 최저가를 실제로 가져와 스냅샷 한 행씩 남긴다 — 이걸 누른 사람 기준으로
// 전원에게 공유되고, 쌓인 기록이 하루 평균/전일 대비/7일 추이의 재료가 된다.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  try {
    const rows = await refreshGemPriceSnapshots(supabase, user.id);
    return NextResponse.json({ snapshots: rows });
  } catch (err) {
    console.error("[lostark/gems] refresh failed:", err);
    if (err instanceof LostArkApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "알 수 없는 오류가 발생했어요." }, { status: 500 });
  }
}
