"use client";

import { useMemo, useState } from "react";
import { setCharacterRaids } from "@/app/actions";
import { totalGold, difficultyColorClass } from "@/lib/raidDisplay";

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
  selectedRaidIds,
  onClose,
  onSaved,
}: {
  characterId: string;
  characterName: string;
  characterItemLevel: number | null;
  allRaids: RaidRow[];
  selectedRaidIds: Set<string>;
  onClose: () => void;
  onSaved: (newSelectedIds: Set<string>) => void;
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
      const chosen = raidsInGroup.find((r) => selectedRaidIds.has(r.id));
      initial.set(groupName, chosen?.id ?? null);
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);

  function pick(groupName: string, raidId: string) {
    setChoicePerGroup((prev) => {
      const next = new Map(prev);
      next.set(groupName, prev.get(groupName) === raidId ? null : raidId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const raidIds = Array.from(choicePerGroup.values()).filter((id): id is string => id !== null);
    try {
      await setCharacterRaids(characterId, raidIds);
      onSaved(new Set(raidIds));
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
          </p>
          <div className="flex flex-col gap-4">
            {groups.map(([groupName, raidsInGroup]) => (
              <div key={groupName}>
                <div className="mb-1.5 text-sm font-medium text-neutral-900">{groupName}</div>
                <div className="flex flex-wrap gap-2">
                  {raidsInGroup.map((raid) => {
                    const active = choicePerGroup.get(groupName) === raid.id;
                    const under = (characterItemLevel ?? 0) < raid.min_item_level;
                    return (
                      <button
                        key={raid.id}
                        type="button"
                        onClick={() => pick(groupName, raid.id)}
                        className={[
                          "rounded-lg border px-3 py-1.5 text-left text-xs",
                          active
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400",
                        ].join(" ")}
                      >
                        <div className={["font-medium", active ? "" : difficultyColorClass(raid.difficulty)].join(" ")}>
                          {raid.difficulty}
                        </div>
                        <div className="text-neutral-400">
                          {totalGold(raid).toLocaleString()}G
                          {under && " · 레벨 미달"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-4">
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
  );
}
