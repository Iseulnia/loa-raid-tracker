"use client";

import { useMemo, useState } from "react";
import AnimatedNumber from "@/components/AnimatedNumber";

// 로스트아크 경매는 상위 입찰 시 이전 입찰가보다 최소 10% 이상 높여야 하는 규칙이 있다. 그래서 "선점가"는
// 단순히 손익분기점보다 낮게 잡은 안전마진이 아니라, 다음 입찰자가 최소 인상폭 규칙상 나를 이기려면 이미
// 손익분기점 이상을 불러야 하게 만드는 가격이다(그 이상은 상대도 이익이 안 나서 사실상 못 올라옴).
// 사용자가 준 실제 화면 스크린샷 숫자로 역산해서 검증한 공식 그대로임.
const BID_INCREMENT_RATIO = 1.1;
// 거래소에 되팔 때 붙는 수수료 — "직접 사용"은 안 되팔 것이므로 이 수수료를 안 뗀 값을 기준으로 한다.
const MARKET_TAX_RATE = 0.05;

const PARTY_SIZE_OPTIONS = [
  { label: "4인", size: 4 },
  { label: "8인", size: 8 },
  { label: "16인", size: 16 },
  { label: "필드보스(30인)", size: 30 },
];

function calc(price: number, partySize: number) {
  const n = partySize;
  const afterTax = price * (1 - MARKET_TAX_RATE);
  // 손익분기점: 낙찰 후 되팔 때까지 감안해서 손익이 0이 되는 지점. 화면에 보여줄 값은 내림하지만, 선점가는
  // 내림하기 전의 정확한 값을 기준으로 계산해야 한다 — 손익분기점을 먼저 내림한 뒤 나누면 오차가 생겨서
  // 스크린샷 실측값(예: 12,361 → 선점가 11,238)과 안 맞고 11,237이 나와버림.
  const breakEvenRaw = (afterTax * (n - 1)) / n;
  const breakEven = Math.floor(breakEvenRaw);
  // 직접 사용 적정가: 되팔 게 아니므로 거래소 수수료 없이 시세 기준으로만 계산.
  const directUse = Math.floor((price * (n - 1)) / n);
  // 선점가: 손익분기점(내림 전 값)을 최소 인상폭(10%)으로 나눠서, 다음 입찰이 곧바로 손익분기점에 닿게
  // 만드는 가격.
  const preemptive = Math.floor(breakEvenRaw / BID_INCREMENT_RATIO);
  // 다른 사람 분배금: 선점가로 낙찰됐을 때 나머지 인원에게 균등 분배되는 금액.
  const othersShare = n > 1 ? Math.floor(preemptive / (n - 1)) : 0;
  // 선점가일 때 나의 순이익: 나중에 거래소에 되팔아서 수수료를 뗀 금액에서 선점가를 뺀 값.
  const myProfit = Math.floor(afterTax - preemptive);

  return { preemptive, breakEven, directUse, othersShare, myProfit };
}

export default function AuctionBidCalculator() {
  const [partySize, setPartySize] = useState(4);
  const [priceInput, setPriceInput] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const price = Number(priceInput) || 0;

  const results = useMemo(() => (price > 0 ? calc(price, partySize) : null), [price, partySize]);

  async function handleCopy(key: string, value: number) {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {
      // 클립보드 권한이 없는 브라우저/컨텍스트일 수 있음 — 조용히 무시(복사만 안 될 뿐 계산 결과는 그대로 보임).
    }
  }

  const rows = results
    ? [
        { key: "preemptive", label: "선점가", value: results.preemptive, accent: "text-emerald-600 dark:text-emerald-400" },
        { key: "breakEven", label: "손익분기점", value: results.breakEven, accent: "text-amber-600 dark:text-amber-400" },
        { key: "directUse", label: "직접 사용 적정가", value: results.directUse, accent: "text-sky-600 dark:text-sky-400" },
        { key: "othersShare", label: "다른 사람 분배금", value: results.othersShare, accent: "text-neutral-700 dark:text-neutral-300" },
        { key: "myProfit", label: "선점가일 때 나의 순이익", value: results.myProfit, accent: "text-indigo-600 dark:text-indigo-400" },
      ]
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">레이드 인원</h2>
        <div className="flex flex-wrap gap-2">
          {PARTY_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.size}
              type="button"
              onClick={() => setPartySize(opt.size)}
              className={[
                "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                partySize === opt.size
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <h2 className="mb-2 mt-5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">현재 경매장 판매가</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="예: 17350"
            className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {priceInput && (
            <button
              type="button"
              onClick={() => setPriceInput("")}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600"
            >
              초기화
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-400">판매가는 숫자만 입력할 수 있어요</p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-sm font-semibold text-neutral-700 dark:text-neutral-300">계산 결과</h2>
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-400">가격을 클릭하면 복사돼요 (게임 안에서 Ctrl+V로 바로 붙여넣기)</p>

        {!rows ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-400">판매가를 입력해주세요.</p>
        ) : (
          <div className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => handleCopy(row.key, row.value)}
                className="flex items-center justify-between gap-3 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              >
                <span className="text-sm text-neutral-500 dark:text-neutral-400">{row.label}</span>
                <span className="flex items-center gap-2">
                  {copiedKey === row.key && <span className="text-xs font-medium text-emerald-500">복사됨</span>}
                  <AnimatedNumber
                    value={row.value}
                    className={`text-lg font-semibold tabular-nums ${row.accent}`}
                    format={(n) => `${n.toLocaleString()}G`}
                  />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
