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
  const [order, setOrder] = useState(characters);
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
          {order.map((c, i) => (
            <li
              key={c.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={handleDragEnd}
              className="flex cursor-grab items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-800"
            >
              <span className="flex items-center gap-1.5 text-neutral-900 dark:text-neutral-100">
                <span className="text-neutral-300 dark:text-neutral-600">⠿</span>
                {c.is_main_character && <span className="text-amber-500">★</span>}
                {c.name}
              </span>
              {c.expedition_label && (
                <span className="text-xs text-neutral-400 dark:text-neutral-400">{c.expedition_label}</span>
              )}
            </li>
          ))}
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
