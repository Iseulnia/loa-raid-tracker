import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchAuctionLowestBuyPrice, LostArkApiError } from "@/lib/lostark";
import { GEMS } from "@/lib/gemPrices";

// 하루 평균/전일 대비/7일 추이를 계산하려면 적어도 지난 8일치가 있어야 "오늘 vs 어제"까지 계산할 수 있다.
const HISTORY_DAYS = 8;

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
  const { data, error } = await supabase
    .from("gem_price_snapshots")
    .select("gem_key, price, recorded_at")
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true });
  if (error) {
    console.error("[lostark/gems] db read failed:", error);
    return NextResponse.json({ error: "저장된 시세를 불러오지 못했어요." }, { status: 500 });
  }

  return NextResponse.json({ snapshots: data ?? [] });
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
    const results = await Promise.all(
      GEMS.map(async (gem) => ({ gem_key: gem.key, price: await searchAuctionLowestBuyPrice(gem.name) }))
    );

    const now = new Date().toISOString();
    const rows = results
      .filter((r): r is { gem_key: string; price: number } => r.price !== null)
      .map((r) => ({ gem_key: r.gem_key, price: r.price, recorded_by: user.id, recorded_at: now }));

    if (rows.length > 0) {
      const { error } = await supabase.from("gem_price_snapshots").insert(rows);
      if (error) {
        console.error("[lostark/gems] db insert failed:", error);
        return NextResponse.json({ error: "가격 저장에 실패했어요." }, { status: 500 });
      }
    }

    return NextResponse.json({ snapshots: rows });
  } catch (err) {
    console.error("[lostark/gems] refresh failed:", err);
    if (err instanceof LostArkApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "알 수 없는 오류가 발생했어요." }, { status: 500 });
  }
}
