"use client";

import { useState } from "react";
import AuctionBidCalculator from "@/components/AuctionBidCalculator";

const TABS = [
  { key: "auction", label: "경매 계산기" },
  { key: "moreRewards", label: "더보기 효율" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function LoaToolsTabs() {
  const [tab, setTab] = useState<TabKey>("auction");

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "auction" && (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">경매 입찰 계산기</h2>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            인원수와 현재 경매장 판매가를 넣으면 선점가·손익분기점·직접 사용 적정가를 계산해줘요. 경매는
            이전 입찰가보다 최소 10% 이상 높여야 하는 규칙이 있어서, &ldquo;선점가&rdquo;는 그 규칙상 다음
            입찰이 곧바로 손익분기점에 닿게 만드는 가격이에요 — 이 가격으로 선점해두면 남이 더 올리기
            부담스러워져요.
          </p>
          <AuctionBidCalculator />
        </section>
      )}

      {tab === "moreRewards" && (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">더보기 효율</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">준비 중이에요. 곧 추가할게요.</p>
        </section>
      )}
    </div>
  );
}
