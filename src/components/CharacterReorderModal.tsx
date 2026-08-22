"use client";

import { useRef, useState } from "react";
import { reorderCharacters } from "@/app/actions";

type CharacterOption = {
  id: string;
  name: string;
  expedition_label: string | null;
  is_main_character: boolean;
};

export default function CharacterReorderModal({
  characters,
  onClose,
  onSaved,
}: {
  characters: CharacterOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // 원정대가 섞여 있으면 찾기 힘들다는 피드백이 있어서, 처음 열 때는 원정대별로 묶어서 보여준다
  // (원정대 미지정은 맨 뒤로). 드래그로 옮기면 그 순간부터는 사용자가 정한 순서를 그대로 따라간다.
  const [order, setOrder] = useState(() =>
    [...characters].sort((a, b) => {
      const labelA = a.expedition_label ?? "￿";
      const labelB = b.expedition_label ?? "￿";
      return labelA.localeCompare(labelB);
    })
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dragIndexRef = useRef<number | null>(null);

  function handleDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function handleDragOver(e: React.DragEvent, overIndex: number) {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === overIndex) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(overIndex, 0, moved);
      return next;
    });
    dragIndexRef.current = overIndex;
  }

  function handleDragEnd() {
    dragIndexRef.current = null;
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await reorderCharacters(order.map((c) => c.id));
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
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-400">드래그해서 순서를 바꾼 뒤 저장하세요.</p>

        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <ul className="mb-4 flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
          {order.map((c, i) => {
            const showHeader = i === 0 || order[i - 1].expedition_label !== c.expedition_label;
            return (
              <li key={c.id}>
                {showHeader && (
                  <div className="mb-1 mt-2 text-xs font-medium text-neutral-400 first:mt-0 dark:text-neutral-400">
                    {c.expedition_label ?? "원정대 미지정"}
                  </div>
                )}
                <div
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  className="flex cursor-grab items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  <span className="text-neutral-300 dark:text-neutral-600">⠿</span>
                  {c.is_main_character && <span className="text-amber-500">★</span>}
                  {c.name}
                </div>
              </li>
            );
          })}
        </ul>

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
