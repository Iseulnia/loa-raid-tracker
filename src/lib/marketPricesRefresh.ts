import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { searchMarketItemsByCategory } from "@/lib/lostark";

// 재련 재료 카테고리 — 더보기 보상으로 나오는 파괴석/수호석/돌파석/파편 주머니류가 모두 여기 속함.
const MATERIAL_CATEGORY_CODE = 50010;

/** 거래소에서 재련 재료 카테고리 전체를 가져와 DB에 upsert한다. 로그인한 사용자가 직접 누른 갱신
 *  (updatedBy=user.id)과 크론이 자동으로 돌린 갱신(updatedBy=null) 양쪽에서 공유해서 쓴다. */
export async function refreshMarketItemPrices(supabase: SupabaseClient<Database>, updatedBy: string | null) {
  const items = await searchMarketItemsByCategory(MATERIAL_CATEGORY_CODE);
  const now = new Date().toISOString();
  const rows = items.map((it) => ({
    item_id: it.Id,
    item_name: it.Name,
    current_min_price: it.CurrentMinPrice,
    bundle_count: it.BundleCount,
    updated_by: updatedBy,
    updated_at: now,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("market_item_prices").upsert(rows, { onConflict: "item_id" });
    if (error) throw error;
  }

  return { items, updatedAt: now };
}
