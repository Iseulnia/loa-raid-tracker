import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchMarketItemsByCategory, LostArkApiError } from "@/lib/lostark";

// 재련 재료 카테고리 — 더보기 보상으로 나오는 파괴석/수호석/돌파석/파편 주머니류가 모두 여기 속함.
const MATERIAL_CATEGORY_CODE = 50010;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  try {
    const items = await searchMarketItemsByCategory(MATERIAL_CATEGORY_CODE);
    const prices = Object.fromEntries(
      items.map((it) => [it.Id, { currentMinPrice: it.CurrentMinPrice, bundleCount: it.BundleCount }])
    );
    return NextResponse.json({ prices });
  } catch (err) {
    console.error("[lostark/market] fetch failed:", err);
    if (err instanceof LostArkApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "알 수 없는 오류가 발생했어요." }, { status: 500 });
  }
}
