"use client";

import { useMemo, useState } from "react";
import {
  MATERIAL_ITEMS,
  FRAGMENT_POUCHES,
  MORE_REWARD_GATES,
  type MaterialKey,
} from "@/lib/moreRewards";

type PriceInfo = { currentMinPrice: number; bundleCount: number };
type PriceMap = Record<number, PriceInfo>;

function unitPriceOf(prices: PriceMap, marketItemId: number): number | null {
  const p = prices[marketItemId];
  if (!p) return null;
  return p.currentMinPrice / p.bundleCount;
}

export default function MoreRewardsEfficiency() {
  const [prices, setPrices] = useState<PriceMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  async function refreshPrices() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lostark/market");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "가격을 불러오지 못했어요.");
      setPrices(data.prices as PriceMap);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  // 파편은 그 자체로 안 팔리고 주머니로만 팔리므로, 소/중/대 중 개당 단가가 제일 싼 주머니를 기준으로 삼는다.
  const cheapestFragmentPouch = useMemo(() => {
    if (!prices) return null;
    let best: { name: string; unitPrice: number } | null = null;
    for (const pouch of FRAGMENT_POUCHES) {
      const p = prices[pouch.marketItemId];
      if (!p) continue;
      const per = p.currentMinPrice / pouch.fragmentsPerPouch;
      if (!best || per < best.unitPrice) best = { name: pouch.name, unitPrice: per };
    }
    return best;
  }, [prices]);

  function gateValue(materials: Partial<Record<MaterialKey, number>>, fragment: number): number | null {
    if (!prices || !cheapestFragmentPouch) return null;
    let total = fragment * cheapestFragmentPouch.unitPrice;
    for (const [key, amount] of Object.entries(materials) as [MaterialKey, number][]) {
      const per = unitPriceOf(prices, MATERIAL_ITEMS[key].marketItemId);
      if (per == null) return null;
      total += amount * per;
    }
    return total;
  }

  const raidOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const g of MORE_REWARD_GATES) {
      if (!seen.has(g.raid)) {
        seen.add(g.raid);
        order.push(g.raid);
      }
    }
    return order;
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">현재가</h3>
            <p className="text-xs text-neutral-400 dark:text-neutral-400">
              {loading
                ? "가격을 불러오는 중..."
                : updatedAt
                ? `마지막 갱신: ${updatedAt.toLocaleTimeString("ko-KR")}`
                : "아직 갱신 전이에요. 갱신 버튼을 눌러주세요."}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshPrices}
            disabled={loading}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600"
          >
            {loading ? "갱신 중..." : "현재가 갱신"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}

        {prices && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(MATERIAL_ITEMS) as MaterialKey[]).map((key) => {
              const meta = MATERIAL_ITEMS[key];
              const per = unitPriceOf(prices, meta.marketItemId);
              return (
                <div key={key} className="rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{meta.name}</p>
                  <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {per == null ? "-" : `${per.toLocaleString(undefined, { maximumFractionDigits: 2 })}G`}
                  </p>
                </div>
              );
            })}
            <div className="rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                운명의 파편 (개당, {cheapestFragmentPouch?.name ?? "-"} 기준)
              </p>
              <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {cheapestFragmentPouch == null
                  ? "-"
                  : `${cheapestFragmentPouch.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}G`}
              </p>
            </div>
          </div>
        )}
      </div>

      {raidOrder.map((raid) => (
        <div key={raid} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{raid}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-400">
                  <th className="py-1.5 pr-3 font-medium">난이도</th>
                  <th className="py-1.5 pr-3 font-medium">관문</th>
                  <th className="py-1.5 pr-3 font-medium">필요 골드</th>
                  <th className="py-1.5 pr-3 font-medium">보상 환산가</th>
                  <th className="py-1.5 font-medium">손익</th>
                </tr>
              </thead>
              <tbody>
                {MORE_REWARD_GATES.filter((g) => g.raid === raid).map((g) => {
                  const value = gateValue(g.materials, g.fragment);
                  const diff = value == null ? null : Math.round(value) - g.gold;
                  return (
                    <tr key={`${g.raid}-${g.difficulty}-${g.gate}`} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                      <td className="py-1.5 pr-3 text-neutral-600 dark:text-neutral-300">{g.difficulty}</td>
                      <td className="py-1.5 pr-3 text-neutral-600 dark:text-neutral-300">{g.gate}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-neutral-600 dark:text-neutral-300">{g.gold.toLocaleString()}G</td>
                      <td className="py-1.5 pr-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                        {value == null ? "-" : `${Math.round(value).toLocaleString()}G`}
                      </td>
                      <td className="py-1.5">
                        {diff == null ? (
                          <span className="text-xs text-neutral-400 dark:text-neutral-500">가격 갱신 필요</span>
                        ) : diff > 0 ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                            이득 +{diff.toLocaleString()}G
                          </span>
                        ) : diff < 0 ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                            손해 {diff.toLocaleString()}G
                          </span>
                        ) : (
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                            본전
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
