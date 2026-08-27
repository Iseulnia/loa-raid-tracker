"use client";

import { useEffect, useMemo, useState } from "react";
import { GEMS } from "@/lib/gemPrices";

type Snapshot = { gem_key: string; price: number; recorded_at: string };

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function avgOf(arr: number[] | undefined): number | null {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

type GemStats = {
  latestPrice: number;
  latestAt: string;
  todayAvg: number | null;
  yesterdayAvg: number | null;
  todayAvgDiff: number | null;
  latestDiffFromYesterdayAvg: number | null;
  series: { date: string; avg: number | null }[];
};

function computeGemStats(snapshots: Snapshot[], gemKey: string): GemStats | null {
  const mine = snapshots.filter((s) => s.gem_key === gemKey).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  if (mine.length === 0) return null;

  const latest = mine[mine.length - 1];

  const byDay = new Map<string, number[]>();
  for (const s of mine) {
    const k = dayKey(s.recorded_at);
    const arr = byDay.get(k) ?? [];
    arr.push(s.price);
    byDay.set(k, arr);
  }

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const todayAvg = avgOf(byDay.get(dayKey(today.toISOString())));
  const yesterdayAvg = avgOf(byDay.get(dayKey(yesterday.toISOString())));

  const series: { date: string; avg: number | null }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    series.push({ date: dayKey(d.toISOString()), avg: avgOf(byDay.get(dayKey(d.toISOString()))) });
  }

  return {
    latestPrice: latest.price,
    latestAt: latest.recorded_at,
    todayAvg,
    yesterdayAvg,
    todayAvgDiff: todayAvg !== null && yesterdayAvg !== null ? todayAvg - yesterdayAvg : null,
    latestDiffFromYesterdayAvg: yesterdayAvg !== null ? latest.price - yesterdayAvg : null,
    series,
  };
}

/** 변동값을 한국 주식 시세 관례대로 상승=빨강/하락=파랑으로 표시하는 배지. */
function DiffBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-[11px] text-neutral-400 dark:text-neutral-500">데이터 수집 중</span>;
  if (Math.abs(diff) < 0.5) {
    return <span className="text-[11px] text-neutral-400 dark:text-neutral-500">어제와 동일</span>;
  }
  const up = diff > 0;
  return (
    <span className={up ? "text-[11px] font-medium text-rose-500" : "text-[11px] font-medium text-sky-500"}>
      {up ? "▲" : "▼"} {Math.abs(Math.round(diff)).toLocaleString()}G
    </span>
  );
}

/** 별도 라이브러리 없이 7일 추이를 그리는 작은 선 그래프. 데이터 없는 날은 이어지지 않고 끊어서 표시한다. */
function TrendSparkline({ series }: { series: { date: string; avg: number | null }[] }) {
  const points = series.filter((p) => p.avg !== null) as { date: string; avg: number }[];
  const width = 220;
  const height = 48;
  const pad = 4;

  if (points.length < 2) {
    return (
      <div className="flex h-12 items-center justify-center text-[11px] text-neutral-400 dark:text-neutral-500">
        추이 데이터 수집 중 (최소 2일 필요)
      </div>
    );
  }

  const values = points.map((p) => p.avg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  // series 안에서의 인덱스(0~6)를 그대로 x좌표로 써서, 데이터 없는 날은 자연스럽게 건너뛴다.
  const indexByDate = new Map(series.map((p, i) => [p.date, i]));
  const coords = points.map((p) => {
    const i = indexByDate.get(p.date)!;
    const x = pad + (i / (series.length - 1)) * (width - pad * 2);
    const y = height - pad - ((p.avg - min) / range) * (height - pad * 2);
    return { x, y };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-12 w-full">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-neutral-400 dark:text-neutral-500" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={2} className="fill-neutral-500 dark:fill-neutral-400" />
      ))}
    </svg>
  );
}

export default function GemPrices() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lostark/gems");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const rows = data.snapshots as Snapshot[];
        setSnapshots(rows);
        if (rows.length > 0) setUpdatedAt(new Date(rows[rows.length - 1].recorded_at));
      } catch {
        // 초기 로딩 실패는 조용히 무시 — 갱신 버튼으로 다시 시도할 수 있음
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lostark/gems", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "가격을 불러오지 못했어요.");
      const inserted = data.snapshots as Snapshot[];
      setSnapshots((prev) => [...prev, ...inserted]);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  const statsByKey = useMemo(() => {
    const map = new Map<string, GemStats | null>();
    for (const gem of GEMS) map.set(gem.key, computeGemStats(snapshots, gem.key));
    return map;
  }, [snapshots]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">겁화·작열의 보석 시세</h3>
          <p className="text-xs text-neutral-400 dark:text-neutral-400">
            {loading
              ? "가격을 불러오는 중..."
              : updatedAt
              ? `마지막 갱신: ${updatedAt.toLocaleString("ko-KR")}`
              : "아직 갱신 전이에요. 갱신 버튼을 눌러주세요."}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-neutral-400 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600"
        >
          {loading ? "갱신 중..." : "현재가 갱신"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        겁화·작열의 보석은 경매장 매물이라 로스트아크 API가 과거 시세를 따로 안 줘요. &ldquo;현재가 갱신&rdquo;을
        누를 때마다 그 시점 최저가를 기록해서 하루 평균·전일 대비·7일 추이를 직접 쌓아가는 방식이라, 갱신을
        누른 만큼 데이터가 채워져요.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GEMS.map((gem) => {
          const stats = statsByKey.get(gem.key);
          return (
            <div key={gem.key} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{gem.name}</span>
                <span
                  className={
                    gem.kind === "겁화"
                      ? "rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-400"
                      : "rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:bg-purple-950 dark:text-purple-400"
                  }
                >
                  {gem.kind}
                </span>
              </div>

              {!stats ? (
                <p className="py-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
                  아직 데이터가 없어요. 갱신 버튼을 눌러주세요.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-end justify-between">
                    <div>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">현재 최저가</p>
                      <p className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                        {stats.latestPrice.toLocaleString()}G
                      </p>
                    </div>
                    <DiffBadge diff={stats.latestDiffFromYesterdayAvg} />
                  </div>
                  <div className="mb-3 flex items-end justify-between">
                    <div>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">오늘 평균가</p>
                      <p className="text-sm font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                        {stats.todayAvg == null ? "-" : `${Math.round(stats.todayAvg).toLocaleString()}G`}
                      </p>
                    </div>
                    <DiffBadge diff={stats.todayAvgDiff} />
                  </div>
                  <TrendSparkline series={stats.series} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
