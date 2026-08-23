import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchMarketItemsByCategory, LostArkApiError } from "@/lib/lostark";

// 재련 재료 카테고리 — 더보기 보상으로 나오는 파괴석/수호석/돌파석/파편 주머니류가 모두 여기 속함.
const MATERIAL_CATEGORY_CODE = 50010;

type PriceMap = Record<number, { currentMinPrice: number; bundleCount: number }>;

// 저장된 시세를 그대로 읽기만 함(외부 API 호출 없음) — 누구 하나가 갱신해두면 나머지는 이걸로 봄.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("market_item_prices")
    .select("item_id, current_min_price, bundle_count, updated_at");
  if (error) {
    console.error("[lostark/market] db read failed:", error);
    return NextResponse.json({ error: "저장된 시세를 불러오지 못했어요." }, { status: 500 });
  }

  const prices: PriceMap = Object.fromEntries(
    (data ?? []).map((row) => [row.item_id, { currentMinPrice: Number(row.current_min_price), bundleCount: row.bundle_count }])
  );
  const updatedAt = (data ?? []).reduce<string | null>(
    (latest, row) => (latest === null || row.updated_at > latest ? row.updated_at : latest),
    null
  );

  return NextResponse.json({ prices, updatedAt });
}

// 로스트아크 API에서 실제 최신 시세를 받아와 DB에 저장한다 — 이걸 누른 사람 기준으로 전원에게 공유됨.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  try {
    const items = await searchMarketItemsByCategory(MATERIAL_CATEGORY_CODE);
    const now = new Date().toISOString();
    const rows = items.map((it) => ({
      item_id: it.Id,
      item_name: it.Name,
      current_min_price: it.CurrentMinPrice,
      bundle_count: it.BundleCount,
      updated_by: user.id,
      updated_at: now,
    }));

    const { error } = await supabase.from("market_item_prices").upsert(rows, { onConflict: "item_id" });
    if (error) {
      console.error("[lostark/market] db upsert failed:", error);
      return NextResponse.json({ error: "가격 저장에 실패했어요." }, { status: 500 });
    }

    const prices: PriceMap = Object.fromEntries(
      items.map((it) => [it.Id, { currentMinPrice: it.CurrentMinPrice, bundleCount: it.BundleCount }])
    );
    return NextResponse.json({ prices, updatedAt: now });
  } catch (err) {
    console.error("[lostark/market] refresh failed:", err);
    if (err instanceof LostArkApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "알 수 없는 오류가 발생했어요." }, { status: 500 });
  }
}
