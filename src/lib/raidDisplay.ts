// 레이드 골드의 귀속/거래가능 분할, 난이도별 색상 등 표시 관련 규칙을 한 곳에 모아둔다.

export type RaidLike = { name: string; gold_per_gate: number[] };

/** 캐릭터 하나가 주간 골드를 받을 수 있는 레이드는 최대 3개 — 숙제 편집에서 유저가 직접 고른다. */
export const MAX_GOLD_EARNING_RAIDS_PER_CHARACTER = 3;

/**
 * 귀속/거래가능 골드 분할 규칙
 * - 성당: 전체 단계(1/2/3단계) 100% 귀속
 * - 4막·종막·세르카: 노말만 절반 귀속 + 절반 거래가능 (하드/나이트메어는 아래 기본값으로 전부 거래가능)
 * - 그 외(위에서 언급 안 된 레이드·난이도, 벨가르딘 등): 전부 거래가능
 */
const FULLY_BOUND_RAID_NAMES = new Set(["성당"]);
const HALF_SPLIT_ON_NORMAL_RAID_NAMES = new Set(["4막", "종막", "세르카"]);

export function totalGold(raid: RaidLike): number {
  return raid.gold_per_gate.reduce((sum, g) => sum + g, 0);
}

export function splitGold(raid: RaidLike & { difficulty: string }): { bound: number; tradeable: number } {
  const total = totalGold(raid);

  if (FULLY_BOUND_RAID_NAMES.has(raid.name)) {
    return { bound: total, tradeable: 0 };
  }

  if (HALF_SPLIT_ON_NORMAL_RAID_NAMES.has(raid.name) && raid.difficulty === "노말") {
    const bound = Math.round(total / 2);
    return { bound, tradeable: total - bound };
  }

  return { bound: 0, tradeable: total };
}

const DIFFICULTY_COLOR_CLASS: Record<string, string> = {
  노말: "text-[#93c5fd]",
  "1단계": "text-[#93c5fd]",
  하드: "text-[#fb923c]",
  "2단계": "text-[#fb923c]",
  나이트메어: "text-violet-600",
  "3단계": "text-violet-600",
};

export function difficultyColorClass(difficulty: string): string {
  return DIFFICULTY_COLOR_CLASS[difficulty] ?? "text-neutral-500";
}
