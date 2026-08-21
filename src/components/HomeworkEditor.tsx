"use client";

import { useMemo, useState } from "react";
import { setCharacterRaids, type CharacterRaidSelection } from "@/app/actions";
import { splitGold, difficultyColorClass, MAX_GOLD_EARNING_RAIDS_PER_CHARACTER } from "@/lib/raidDisplay";

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
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h3 className="font-semibold text-neutral-900">{characterName} 숙제 편집</h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            닫기
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-xs text-neutral-500">
            레이드마다 난이도를 하나만 고를 수 있어요. 다시 누르면 선택이 풀립니다.
            <br />
            골드는 캐릭터 하나당 최대 {MAX_GOLD_EARNING_RAIDS_PER_CHARACTER}개까지만 받을 수 있어요. 고른 레이드
            아래 &ldquo;골드 받기&rdquo;를 눌러 직접 골라주세요.
          </p>
          <div className="flex flex-col gap-4">
            {groups.map(([groupName, raidsInGroup]) => (
              <div key={groupName}>
                <div className="mb-1.5 text-sm font-medium text-neutral-900">{groupName}</div>
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
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-neutral-200 bg-white text-neutral-600",
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
                            {tradeable > 0 && <span className="text-amber-600">{tradeable.toLocaleString()}G</span>}
                            {tradeable > 0 && bound > 0 && <span className="text-neutral-300">/</span>}
                            {bound > 0 && <span className="text-indigo-600">{bound.toLocaleString()}G</span>}
                          </div>
                          {under && <div className="text-neutral-400">레벨 미달</div>}
                        </button>

                        {active && (
                          <button
                            type="button"
                            onClick={() => toggleGoldEarning(raid.id)}
                            disabled={!goldEarning && goldEarningIds.size >= MAX_GOLD_EARNING_RAIDS_PER_CHARACTER}
                            className={[
                              "mt-1.5 w-full rounded border px-1.5 py-0.5 text-[10px]",
                              goldEarning
                                ? "border-emerald-400 bg-emerald-100 text-emerald-700"
                                : "border-neutral-300 bg-white text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50",
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

        <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-4">
          <span className="text-xs text-neutral-400">
            골드 받기 {goldEarningIds.size}/{MAX_GOLD_EARNING_RAIDS_PER_CHARACTER}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-neutral-500 hover:text-neutral-800"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
