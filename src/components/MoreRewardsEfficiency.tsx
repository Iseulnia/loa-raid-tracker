"use client";

import { Fragment, useMemo, useState } from "react";
import {
  MATERIAL_ITEMS,
  FRAGMENT_POUCHES,
  MORE_REWARD_GATES,
  type MaterialKey,
  type MoreRewardGate,
} from "@/lib/moreRewards";

type PriceInfo = { currentMinPrice: number; bundleCount: number };
type PriceMap = Record<number, PriceInfo>;

// 100개 묶음으로 거래되는 재료는 인게임 거래소 표시와 똑같이 "100개당 가격"을 그대로 보여준다
// (개당으로 쪼개서 보여주면 오히려 게임 화면이랑 비교하기 불편해서).
const BUNDLE_100_KEYS: MaterialKey[] = ["destructionStone", "guardianStone", "destructionCrystal", "guardianCrystal"];
const SINGLE_KEYS: MaterialKey[] = ["breakthroughStone", "greatBreakthroughStone"];

function unitPriceOf(prices: PriceMap, marketItemId: number): number | null {
  const p = prices[marketItemId];
  if (!p) return null;
  return p.currentMinPrice / p.bundleCount;
}

function gateKeyOf(g: MoreRewardGate): string {
  return `${g.raid}-${g.difficulty}-${g.gate}`;
}

export default function MoreRewardsEfficiency() {
  const [prices, setPrices] = useState<PriceMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
    let best: { pouch: (typeof FRAGMENT_POUCHES)[number]; unitPrice: number } | null = null;
    for (const pouch of FRAGMENT_POUCHES) {
      const p = prices[pouch.marketItemId];
      if (!p) continue;
      const per = p.currentMinPrice / pouch.fragmentsPerPouch;
      if (!best || per < best.unitPrice) best = { pouch, unitPrice: per };
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

  function materialBreakdown(g: MoreRewardGate) {
    const rows: { name: string; amount: number; unitPrice: number | null; subtotal: number | null }[] = [];
    for (const [key, amount] of Object.entries(g.materials) as [MaterialKey, number][]) {
      const meta = MATERIAL_ITEMS[key];
      const per = prices ? unitPriceOf(prices, meta.marketItemId) : null;
      rows.push({ name: meta.name, amount, unitPrice: per, subtotal: per == null ? null : per * amount });
    }
    const fragPer = cheapestFragmentPouch?.unitPrice ?? null;
    rows.push({
      name: cheapestFragmentPouch ? `운명의 파편 (${cheapestFragmentPouch.pouch.name} 기준)` : "운명의 파편",
      amount: g.fragment,
      unitPrice: fragPer,
      subtotal: fragPer == null ? null : fragPer * g.fragment,
    });
    return rows;
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
            {BUNDLE_100_KEYS.map((key) => {
              const meta = MATERIAL_ITEMS[key];
              const price = prices[meta.marketItemId]?.currentMinPrice ?? null;
              return (
                <div key={key} className="rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{meta.name} (100개당)</p>
                  <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {price == null ? "-" : `${price.toLocaleString()}G`}
                  </p>
                </div>
              );
            })}
            {SINGLE_KEYS.map((key) => {
              const meta = MATERIAL_ITEMS[key];
              const price = prices[meta.marketItemId]?.currentMinPrice ?? null;
              return (
                <div key={key} className="rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{meta.name} (개당)</p>
                  <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {price == null ? "-" : `${price.toLocaleString()}G`}
                  </p>
                </div>
              );
            })}
            {FRAGMENT_POUCHES.map((pouch) => {
              const price = prices[pouch.marketItemId]?.currentMinPrice ?? null;
              const inUse = cheapestFragmentPouch?.pouch.marketItemId === pouch.marketItemId;
              return (
                <div
                  key={pouch.marketItemId}
                  className={[
                    "rounded-md px-3 py-2",
                    inUse
                      ? "bg-emerald-50 ring-1 ring-inset ring-emerald-300 dark:bg-emerald-950 dark:ring-emerald-800"
                      : "bg-neutral-50 dark:bg-neutral-800/60",
                  ].join(" ")}
                >
                  <p className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {pouch.name}
                    {inUse && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                        계산에 사용
                      </span>
                    )}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {price == null ? "-" : `${price.toLocaleString()}G`}
                  </p>
                </div>
              );
            })}
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
                  const key = gateKeyOf(g);
                  const expanded = expandedKey === key;
                  const value = gateValue(g.materials, g.fragment);
                  const diff = value == null ? null : Math.round(value) - g.gold;
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => setExpandedKey(expanded ? null : key)}
                        className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/40"
                      >
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
                      {expanded && (
                        <tr key={`${key}-detail`} className="border-b border-neutral-100 dark:border-neutral-800/60">
                          <td colSpan={5} className="bg-neutral-50 px-3 py-3 dark:bg-neutral-800/40">
                            <table className="w-full border-collapse text-xs">
                              <thead>
                                <tr className="text-left text-neutral-400 dark:text-neutral-500">
                                  <th className="pb-1 pr-3 font-medium">재료</th>
                                  <th className="pb-1 pr-3 font-medium">필요 개수</th>
                                  <th className="pb-1 pr-3 font-medium">단가</th>
                                  <th className="pb-1 font-medium">구매 시 가격</th>
                                </tr>
                              </thead>
                              <tbody>
                                {materialBreakdown(g).map((row) => (
                                  <tr key={row.name}>
                                    <td className="py-0.5 pr-3 text-neutral-600 dark:text-neutral-300">{row.name}</td>
                                    <td className="py-0.5 pr-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                                      {row.amount.toLocaleString()}개
                                    </td>
                                    <td className="py-0.5 pr-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                                      {row.unitPrice == null
                                        ? "-"
                                        : `${row.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 3 })}G`}
                                    </td>
                                    <td className="py-0.5 tabular-nums text-neutral-600 dark:text-neutral-300">
                                      {row.subtotal == null ? "-" : `${Math.round(row.subtotal).toLocaleString()}G`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
