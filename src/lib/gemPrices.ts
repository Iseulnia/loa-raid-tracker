// 로아 도구 > 보석 가격 탭에서 추적하는 겁화/작열의 보석 6종.
// gem_key는 gem_price_snapshots 테이블의 gem_key 컬럼과 그대로 맞춰서 쓴다.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { searchAuctionLowestBuyPrice } from "@/lib/lostark";

export type GemDef = { key: string; name: string; level: number; kind: "겁화" | "작열" };

export const GEMS: GemDef[] = [
  { key: "gyeokhwa_8", name: "8레벨 겁화의 보석", level: 8, kind: "겁화" },
  { key: "jagyeol_8", name: "8레벨 작열의 보석", level: 8, kind: "작열" },
  { key: "gyeokhwa_9", name: "9레벨 겁화의 보석", level: 9, kind: "겁화" },
  { key: "jagyeol_9", name: "9레벨 작열의 보석", level: 9, kind: "작열" },
  { key: "gyeokhwa_10", name: "10레벨 겁화의 보석", level: 10, kind: "겁화" },
  { key: "jagyeol_10", name: "10레벨 작열의 보석", level: 10, kind: "작열" },
];

/** 경매장에서 6종 보석의 현재 최저가를 가져와 스냅샷 한 행씩 DB에 남긴다. 로그인한 사용자가 직접 누른
 *  갱신(recordedBy=user.id)과 크론이 자동으로 돌린 갱신(recordedBy=null) 양쪽에서 공유해서 쓴다. */
export async function refreshGemPriceSnapshots(supabase: SupabaseClient<Database>, recordedBy: string | null) {
  const results = await Promise.all(
    GEMS.map(async (gem) => ({ gem_key: gem.key, price: await searchAuctionLowestBuyPrice(gem.name) }))
  );

  const now = new Date().toISOString();
  const rows = results
    .filter((r): r is { gem_key: string; price: number } => r.price !== null)
    .map((r) => ({ gem_key: r.gem_key, price: r.price, recorded_by: recordedBy, recorded_at: now }));

  if (rows.length > 0) {
    const { error } = await supabase.from("gem_price_snapshots").insert(rows);
    if (error) throw error;
  }
  return rows;
}
