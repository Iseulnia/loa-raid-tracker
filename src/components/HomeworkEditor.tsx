"use client";

import { useMemo, useState } from "react";
import { setCharacterRaids, type CharacterRaidSelection } from "@/app/actions";
import { splitGold, totalGold, difficultyColorClass, MAX_GOLD_EARNING_RAIDS_PER_CHARACTER } from "@/lib/raidDisplay";

type RaidRow = {
  id: string;
  name: string;
  difficulty: string;
  min_item_level: number;
  gate_count: number;
  gold_per_gate: number[];
  sort_order: number;
};

export default function HomeworkEditor({
  characterId,
  characterName,
  characterItemLevel,
  allRaids,
  initialSelections,
  onClose,
  onSaved,
}: {
  characterId: string;
  characterName: string;
  characterItemLevel: number | null;
  allRaids: RaidRow[];
  initialSelections: Map<string, boolean>;
  onClose: () => void;
  onSaved: (newSelections: Map<string, boolean>) => void;
}) {
  // 레이드 이름(성당/4막/종막...)별로 그룹화 — 같은 레이드는 난이도 하나만 고를 수 있음
  const groups = useMemo(() => {
    const map = new Map<string, RaidRow[]>();
    for (const raid of allRaids) {
      const list = map.get(raid.name) ?? [];
      list.push(raid);
      map.set(raid.name, list);
    }
    return Array.from(map.entries()).sort(
      (a, b) => Math.min(...a[1].map((r) => r.sort_order)) - Math.min(...b[1].map((r) => r.sort_order))
    );
  }, [allRaids]);

  const [choicePerGroup, setChoicePerGroup] = useState<Map<string, string | null>>(() => {
    const initial = new Map<string, string | null>();
    for (const [groupName, raidsInGroup] of groups) {
      const chosen = raidsInGroup.find((r) => initialSelections.has(r.id));
      initial.set(groupName, chosen?.id ?? null);
    }
    return initial;
  });
  const [goldEarningIds, setGoldEarningIds] = useState<Set<string>>(
    () => new Set(Array.from(initialSelections.entries()).filter(([, gold]) => gold).map(([id]) => id))
  );
  const [saving, setSaving] = useState(false);
  const [showAutoSelectMenu, setShowAutoSelectMenu] = useState(false);

  /** 그룹(레이드)마다 캐릭터가 갈 수 있는 난이도 중 골드가 제일 높은 걸 고르고,
   *  그중 상위 3개 그룹만 선택 + 골드 받기로 설정한다. 나머지 그룹은 선택 해제. */
  function runAutoSelect(metric: "tradeable" | "total") {
    const goldOf = (raid: RaidRow) => (metric === "tradeable" ? splitGold(raid).tradeable : totalGold(raid));

    const bestPerGroup = new Map<string, RaidRow>();
    for (const [groupName, raidsInGroup] of groups) {
      const eligible = raidsInGroup.filter((r) => (characterItemLevel ?? 0) >= r.min_item_level);
      if (eligible.length === 0) continue;
      const best = eligible.reduce((a, b) => (goldOf(b) > goldOf(a) ? b : a));
      bestPerGroup.set(groupName, best);
    }

    const topGroups = Array.from(bestPerGroup.entries())
      .sort((a, b) => goldOf(b[1]) - goldOf(a[1]))
      .slice(0, MAX_GOLD_EARNING_RAIDS_PER_CHARACTER)
      .map(([groupName]) => groupName);
    const topGroupSet = new Set(topGroups);

    const nextChoicePerGroup = new Map<string, string | null>();
    const nextGoldEarning = new Set<string>();
    for (const [groupName] of groups) {
      if (topGroupSet.has(groupName)) {
        const raid = bestPerGroup.get(groupName)!;
        nextChoicePerGroup.set(groupName, raid.id);
        nextGoldEarning.add(raid.id);
      } else {
        nextChoicePerGroup.set(groupName, null);
      }
    }

    setChoicePerGroup(nextChoicePerGroup);
    setGoldEarningIds(nextGoldEarning);
    setShowAutoSelectMenu(false);
  }

  function pick(groupName: string, raid: RaidRow) {
    const eligible = (characterItemLevel ?? 0) >= raid.min_item_level;
    if (!eligible) return;

    const previousChoice = choicePerGroup.get(groupName) ?? null;
    const deselecting = previousChoice === raid.id;
    const newChoice = deselecting ? null : raid.id;

    setChoicePerGroup((prev) => {
      const next = new Map(prev);
      next.set(groupName, newChoice);
      return next;
    });

    setGoldEarningIds((prev) => {
      const next = new Set(prev);
      if (previousChoice) next.delete(previousChoice);
      if (newChoice && next.size < MAX_GOLD_EARNING_RAIDS_PER_CHARACTER) {
        next.add(newChoice);
      }
      return next;
    });
  }

  function toggleGoldEarning(raidId: string) {
    setGoldEarningIds((prev) => {
      const next = new Set(prev);
      if (next.has(raidId)) {
        next.delete(raidId);
      } else {
        if (next.size >= MAX_GOLD_EARNING_RAIDS_PER_CHARACTER) return prev; // 이미 3개 다 참
        next.add(raidId);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const selectedIds = Array.from(choicePerGroup.values()).filter((id): id is string => id !== null);
    const selections: CharacterRaidSelection[] = selectedIds.map((raidId) => ({
      raidId,
      goldEarning: goldEarningIds.has(raidId),
    }));
    try {
      await setCharacterRaids(characterId, selections);
      onSaved(new Map(selections.map((s) => [s.raidId, s.goldEarning])));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{characterName} 숙제 편집</h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
            닫기
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            레이드마다 난이도를 하나만 고를 수 있어요. 다시 누르면 선택이 풀립니다.
            <br />
            골드는 캐릭터 하나당 최대 {MAX_GOLD_EARNING_RAIDS_PER_CHARACTER}개까지만 받을 수 있어요. 고른 레이드
            아래 &ldquo;골드 받기&rdquo;를 눌러 직접 골라주세요.
          </p>

          <div className="relative mb-4 inline-block">
            <button
              type="button"
              onClick={() => setShowAutoSelectMenu((v) => !v)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600"
            >
              골드 최대화 자동 선택 (상위 {MAX_GOLD_EARNING_RAIDS_PER_CHARACTER}개)
            </button>
            {showAutoSelectMenu && (
              <div className="absolute left-0 z-10 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                <button
                  type="button"
                  onClick={() => runAutoSelect("tradeable")}
                  className="block w-full rounded-md px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  <div className="font-medium text-amber-600 dark:text-amber-400">거래가능 골드 기준</div>
                  <div className="text-neutral-400 dark:text-neutral-400">거래가능 골드가 제일 많은 조합으로 선택</div>
                </button>
                <button
                  type="button"
                  onClick={() => runAutoSelect("total")}
                  className="block w-full rounded-md px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">거래가능 + 귀속 골드 기준</div>
                  <div className="text-neutral-400 dark:text-neutral-400">종류 상관없이 총 골드가 제일 많은 조합으로 선택</div>
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-4">
            {groups.map(([groupName, raidsInGroup]) => (
              <div key={groupName}>
                <div className="mb-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">{groupName}</div>
                <div className="flex flex-wrap gap-2">
                  {raidsInGroup.map((raid) => {
                    const active = choicePerGroup.get(groupName) === raid.id;
                    const under = (characterItemLevel ?? 0) < raid.min_item_level;
                    const goldEarning = active && goldEarningIds.has(raid.id);
                    const { bound, tradeable } = splitGold(raid);
                    return (
                      <div
                        key={raid.id}
                        className={[
                          "rounded-lg border px-3 py-1.5 text-xs",
                          active
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-400"
                            : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400",
                          under ? "opacity-40" : "",
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          disabled={under}
                          onClick={() => pick(groupName, raid)}
                          title={under ? "아이템레벨 미달" : undefined}
                          className={["block text-left", under ? "cursor-not-allowed" : "cursor-pointer"].join(" ")}
                        >
                          <div
                            className={["font-medium", active ? "" : difficultyColorClass(raid.difficulty)].join(" ")}
                          >
                            {raid.difficulty}
                          </div>
                          <div className="flex items-center gap-1">
                            {tradeable > 0 && <span className="text-amber-600 dark:text-amber-400">{tradeable.toLocaleString()}G</span>}
                            {tradeable > 0 && bound > 0 && <span className="text-neutral-300 dark:text-neutral-500">/</span>}
                            {bound > 0 && <span className="text-indigo-600 dark:text-indigo-400">{bound.toLocaleString()}G</span>}
                          </div>
                          {under && <div className="text-neutral-400 dark:text-neutral-400">레벨 미달</div>}
                        </button>

                        {active && (
                          <button
                            type="button"
                            onClick={() => toggleGoldEarning(raid.id)}
                            disabled={!goldEarning && goldEarningIds.size >= MAX_GOLD_EARNING_RAIDS_PER_CHARACTER}
                            className={[
                              "mt-1.5 w-full rounded border px-1.5 py-0.5 text-[10px]",
                              goldEarning
                                ? "border-emerald-400 bg-emerald-100 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900 dark:text-emerald-300"
                                : "border-neutral-300 bg-white text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-400",
                            ].join(" ")}
                          >
                            {goldEarning ? "✓ 골드 받기" : "골드 받기"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <span className="text-xs text-neutral-400 dark:text-neutral-400">
            골드 받기 {goldEarningIds.size}/{MAX_GOLD_EARNING_RAIDS_PER_CHARACTER}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
