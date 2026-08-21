// 레이드 골드의 귀속/거래가능 분할, 난이도별 색상 등 표시 관련 규칙을 한 곳에 모아둔다.

export type RaidLike = { name: string; gold_per_gate: number[] };

/** 성당(전체 단계)·세르카·4막·종막은 클리어 골드의 절반이 귀속, 절반이 거래가능. 그 외(벨가르딘 등)는 전부 거래가능. */
const HALF_SPLIT_RAID_NAMES = new Set(["성당", "세르카", "4막", "종막"]);

export function totalGold(raid: RaidLike): number {
  return raid.gold_per_gate.reduce((sum, g) => sum + g, 0);
}

export function splitGold(raid: RaidLike): { bound: number; tradeable: number } {
  const total = totalGold(raid);
  if (HALF_SPLIT_RAID_NAMES.has(raid.name)) {
    const bound = Math.round(total / 2);
    return { bound, tradeable: total - bound };
  }
  return { bound: 0, tradeable: total };
}

const DIFFICULTY_COLOR_CLASS: Record<string, string> = {
  노말: "text-emerald-600",
  "1단계": "text-emerald-600",
  하드: "text-rose-600",
  "2단계": "text-rose-600",
  나이트메어: "text-violet-600",
  "3단계": "text-violet-600",
};

export function difficultyColorClass(difficulty: string): string {
  return DIFFICULTY_COLOR_CLASS[difficulty] ?? "text-neutral-500";
}
