"use client";

import { useRef, useState } from "react";
import { reorderCharacters } from "@/app/actions";

type CharacterOption = {
  id: string;
  name: string;
  expedition_label: string | null;
  is_main_character: boolean;
};

type Group = { label: string | null; characters: CharacterOption[] };

function buildGroups(characters: CharacterOption[]): Group[] {
  const map = new Map<string, CharacterOption[]>();
  for (const c of characters) {
    const key = c.expedition_label ?? "";
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .map(([key, chars]) => ({ label: key === "" ? null : key, characters: chars }))
    .sort((a, b) => {
      const labelA = a.label ?? "￿";
      const labelB = b.label ?? "￿";
      return labelA.localeCompare(labelB);
    });
}

export default function CharacterReorderModal({
  characters,
  onClose,
  onSaved,
}: {
  characters: CharacterOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // 원정대별로 묶어서 보여준다 (섞여 있으면 찾기 힘들다는 피드백). 원정대 "안"에서는 캐릭터를 드래그로,
  // 원정대 "자체" 순서는 화살표 버튼으로 바꾼다 — 드래그를 그룹 경계 넘어서까지 허용하면 원정대 순서가
  // 의도치 않게 뒤섞이기 쉬워서 일부러 분리함.
  const [groups, setGroups] = useState(() => buildGroups(characters));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dragRef = useRef<{ groupIndex: number; itemIndex: number } | null>(null);

  function moveGroup(groupIndex: number, direction: -1 | 1) {
    setGroups((prev) => {
      const targetIndex = groupIndex + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[groupIndex], next[targetIndex]] = [next[targetIndex], next[groupIndex]];
      return next;
    });
  }

  function handleDragStart(groupIndex: number, itemIndex: number) {
    dragRef.current = { groupIndex, itemIndex };
  }

  function handleDragOver(e: React.DragEvent, groupIndex: number, itemIndex: number) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag || drag.groupIndex !== groupIndex || drag.itemIndex === itemIndex) return;
    setGroups((prev) => {
      const next = [...prev];
      const chars = [...next[groupIndex].characters];
      const [moved] = chars.splice(drag.itemIndex, 1);
      chars.splice(itemIndex, 0, moved);
      next[groupIndex] = { ...next[groupIndex], characters: chars };
      return next;
    });
    dragRef.current = { groupIndex, itemIndex };
  }

  function handleDragEnd() {
    dragRef.current = null;
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const ids = groups.flatMap((g) => g.characters.map((c) => c.id));
      await reorderCharacters(ids);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg bg-white p-4 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">캐릭터 순서 변경</h2>
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-400">
          원정대 안에서는 캐릭터를 드래그, 원정대 자체 순서는 화살표로 바꿀 수 있어요.
        </p>

        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mb-4 flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {groups.map((group, groupIndex) => (
            <div key={group.label ?? "__unassigned"}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-400 dark:text-neutral-400">
                  {group.label ?? "원정대 미지정"}
                </span>
                {groups.length > 1 && (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveGroup(groupIndex, -1)}
                      disabled={groupIndex === 0}
                      title="원정대 위로"
                      className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 disabled:opacity-30 disabled:hover:border-neutral-200 disabled:hover:text-neutral-500 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveGroup(groupIndex, 1)}
                      disabled={groupIndex === groups.length - 1}
                      title="원정대 아래로"
                      className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 disabled:opacity-30 disabled:hover:border-neutral-200 disabled:hover:text-neutral-500 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
                    >
                      ▼
                    </button>
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-1.5">
                {group.characters.map((c, itemIndex) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={() => handleDragStart(groupIndex, itemIndex)}
                    onDragOver={(e) => handleDragOver(e, groupIndex, itemIndex)}
                    onDragEnd={handleDragEnd}
                    className="flex cursor-grab items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    <span className="text-neutral-300 dark:text-neutral-600">⠿</span>
                    {c.is_main_character && <span className="text-amber-500">★</span>}
                    {c.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
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
  );
}
