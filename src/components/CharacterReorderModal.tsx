"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { reorderCharacters } from "@/app/actions";

type CharacterOption = {
  id: string;
  name: string;
  expedition_label: string | null;
  is_main_character: boolean;
};

type Group = { label: string | null; characters: CharacterOption[] };

/** 대시보드에 뜨는 순서와 다르게 보이면 헷갈린다는 피드백이 있어서, 여기서 별도로 다시 정렬하지 않고
 *  (예전엔 원정대 라벨 알파벳순으로 다시 정렬해서 대시보드와 순서가 달랐음) 이미 sort_order로 정렬돼서
 *  들어오는 characters 배열을 순서 그대로 순회하며 그룹만 나눈다 — 원정대 그룹 순서는 자연히 "그 안에서
 *  가장 먼저 나오는(=sort_order가 가장 작은) 캐릭터" 기준이 되어 대시보드의 groupByExpedition과 동일한
 *  결과가 된다. 원정대 미지정(null) 그룹만 대시보드와 동일하게 항상 맨 뒤로 보낸다. */
function buildGroups(characters: CharacterOption[]): Group[] {
  const map = new Map<string, CharacterOption[]>();
  for (const c of characters) {
    const key = c.expedition_label ?? "";
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  const groups = Array.from(map.entries()).map(([key, chars]) => ({
    label: key === "" ? null : key,
    characters: chars,
  }));
  const assigned = groups.filter((g) => g.label !== null);
  const unassigned = groups.filter((g) => g.label === null);
  return [...assigned, ...unassigned];
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

  // 네이티브 HTML5 드래그는 목록 순서가 바뀔 때마다 항목이 순간이동하듯 툭툭 끊겨 보여서, FLIP 기법으로
  // 부드럽게 밀리는 것처럼 보이게 한다: 순서가 바뀐 직후 각 항목을 "바뀌기 전 위치"로 즉시(트랜지션 없이)
  // 옮겨두고, 다음 프레임에 트랜지션을 걸어서 제자리로 돌아오게 한다.
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const rafIdRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    // 직전 순서 변경에서 예약해둔 rAF가 아직 안 끝난 채로 다음 순서 변경이 들어오면, 그 오래된 콜백이
    // 이번에 새로 건 트랜지션/transform을 나중에 덮어써서 애니메이션이 두 번 재생되는 것처럼 보였다.
    // 새로 예약하기 전에 이전 예약을 취소해서 항상 가장 최근 것 하나만 실행되게 한다.
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // 드래그 중엔 dragover가 아주 빠르게 여러 번 발생해서, 이전 순서 변경의 200ms 트랜지션이 채 안 끝난
    // 채로 다음 순서 변경이 들어오는 경우가 흔하다. 그 상태에서 그냥 getBoundingClientRect를 재면 트랜지션
    // 도중의 어중간한 위치를 "지금 자리"로 잘못 측정하게 돼서 델타 계산이 틀어지고, 그 결과 애니메이션이
    // 안 먹히거나 어긋나 보이는 게 바로 "적용될 때도 있고 안 될 때도 있는" 원인이었다. 매번 측정하기 전에
    // 먼저 트랜지션 없이 transform을 확실히 지워서, 항상 "진짜 배치된 자리"를 기준으로 계산하게 고친다.
    itemRefs.current.forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "";
    });

    const nextRects = new Map<string, DOMRect>();
    itemRefs.current.forEach((el, id) => {
      nextRects.set(id, el.getBoundingClientRect());
    });

    itemRefs.current.forEach((el, id) => {
      const prev = prevRectsRef.current.get(id);
      const next = nextRects.get(id);
      if (!prev || !next) return;
      const deltaY = prev.top - next.top;
      if (Math.abs(deltaY) < 0.5) return;
      el.style.transform = `translateY(${deltaY}px)`;
      el.getBoundingClientRect(); // 강제 리플로우 — 트랜지션을 걸기 전에 지금 transform이 먼저 반영되게 함
    });

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      itemRefs.current.forEach((el) => {
        el.style.transition = "transform 200ms ease";
        el.style.transform = "";
      });
    });

    prevRectsRef.current = nextRects;
  }, [groups]);

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

  function handleDragOver(e: React.DragEvent<HTMLLIElement>, groupIndex: number, itemIndex: number) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag || drag.groupIndex !== groupIndex || drag.itemIndex === itemIndex) return;

    // 대상 항목에 살짝만 걸쳐도 바로 자리를 바꾸면, 바뀌는 순간 그 자리에 있던 항목이 커서 밑으로 오면서
    // 다시 dragover가 걸려 원래대로 되돌리는 일이 반복돼서 위아래로 계속 왔다갔다하는 것처럼 보였다.
    // 커서가 대상 항목의 "중간선"을 실제로 넘어야만(아래로 옮기는 중이면 중간보다 아래로, 위로 옮기는
    // 중이면 중간보다 위로) 자리를 바꾸도록 여유(hysteresis)를 둬서 이 진동을 막는다.
    const rect = e.currentTarget.getBoundingClientRect();
    const midpointY = rect.top + rect.height / 2;
    const movingDown = itemIndex > drag.itemIndex;
    if (movingDown && e.clientY < midpointY) return;
    if (!movingDown && e.clientY > midpointY) return;

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
                    ref={(el) => {
                      if (el) itemRefs.current.set(c.id, el);
                      else itemRefs.current.delete(c.id);
                    }}
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
