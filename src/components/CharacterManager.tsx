"use client";

import { useMemo, useState, useTransition } from "react";
import {
  importCharacters,
  toggleGoldEarner,
  deleteCharacter,
  setMainCharacter,
  refreshCombatPower,
  resetCombatPower,
  type ImportableCharacter,
} from "@/app/actions";
import type { LostArkSibling } from "@/lib/lostark";
import { parseFormattedNumber } from "@/lib/lostark";

type RosterEntry = LostArkSibling & { CombatPower: number | null };

type CharacterRow = {
  id: string;
  owner_id: string;
  name: string;
  server: string | null;
  class: string | null;
  item_level: number | null;
  combat_power: number | null;
  is_gold_earner: boolean;
  expedition_label: string | null;
  is_main_character: boolean;
  sort_order: number;
};

function byItemLevelDesc<T extends { ItemAvgLevel: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => parseFormattedNumber(b.ItemAvgLevel) - parseFormattedNumber(a.ItemAvgLevel));
}

export default function CharacterManager({ initialCharacters }: { initialCharacters: CharacterRow[] }) {
  const [mainName, setMainName] = useState("");
  const [expeditionLabel, setExpeditionLabel] = useState("");
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [characters, setCharacters] = useState(initialCharacters);
  const [, startTransition] = useTransition();
  const [busyCombatPowerId, setBusyCombatPowerId] = useState<string | null>(null);

  const groupedCharacters = useMemo(() => {
    const groups = new Map<string, CharacterRow[]>();
    for (const c of characters) {
      const key = c.expedition_label ?? "";
      const list = groups.get(key) ?? [];
      list.push(c);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => {
        if (a.is_main_character !== b.is_main_character) return a.is_main_character ? -1 : 1;
        return (b.item_level ?? 0) - (a.item_level ?? 0);
      });
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === "") return 1; // 원정대 미지정은 맨 뒤로
      if (b[0] === "") return -1;
      const maxA = Math.max(...a[1].map((c) => c.item_level ?? 0));
      const maxB = Math.max(...b[1].map((c) => c.item_level ?? 0));
      return maxB - maxA;
    });
  }, [characters]);

  async function handleFetchRoster(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setRoster(null);
    try {
      const res = await fetch(`/api/lostark/roster?name=${encodeURIComponent(mainName)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "불러오기 실패");
      const sorted = byItemLevelDesc<RosterEntry>(data.roster);
      setRoster(sorted);
      // 아이템레벨 높은 순으로 최대 6개까지만 기본 선택 (그 이상은 직접 체크하도록)
      setSelected(new Set(sorted.slice(0, 6).map((r) => r.CharacterName)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!roster) return;
    const label = expeditionLabel.trim() || null;
    const toImport: ImportableCharacter[] = roster
      .filter((r) => selected.has(r.CharacterName))
      .map((r) => ({
        name: r.CharacterName,
        server: r.ServerName,
        className: r.CharacterClassName,
        itemLevel: parseFormattedNumber(r.ItemAvgLevel),
        combatPower: r.CombatPower,
      }));
    await importCharacters(toImport, label);
    // 낙관적으로 화면에 반영 (정확한 최신 목록은 새로고침 시 서버에서 다시 받음)
    setCharacters((prev) => {
      const byName = new Map(prev.map((c) => [c.name, c]));
      for (const c of toImport) {
        const existing = byName.get(c.name);
        byName.set(c.name, {
          id: existing?.id ?? c.name,
          owner_id: existing?.owner_id ?? "",
          name: c.name,
          server: c.server,
          class: c.className,
          item_level: c.itemLevel,
          combat_power: c.combatPower,
          is_gold_earner: existing?.is_gold_earner ?? true,
          expedition_label: label,
          is_main_character: existing?.is_main_character ?? false,
          sort_order: existing?.sort_order ?? prev.length,
        });
      }
      return Array.from(byName.values());
    });
    setRoster(null);
    setMainName("");
    setExpeditionLabel("");
  }

  async function handleRefreshCombatPower(character: CharacterRow) {
    setBusyCombatPowerId(character.id);
    setError("");
    try {
      const newValue = await refreshCombatPower(character.id);
      setCharacters((prev) => prev.map((x) => (x.id === character.id ? { ...x, combat_power: newValue } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "전투력 갱신에 실패했어요.");
    } finally {
      setBusyCombatPowerId(null);
    }
  }

  async function handleResetCombatPower(character: CharacterRow) {
    const confirmed = window.confirm(
      `${character.name}의 저장된 최고 전투력 기록을 지우고, 지금 API 값으로 다시 맞출까요? (스펙이 실제로 다운됐을 때만 사용하세요)`
    );
    if (!confirmed) return;

    setBusyCombatPowerId(character.id);
    setError("");
    try {
      const newValue = await resetCombatPower(character.id);
      setCharacters((prev) => prev.map((x) => (x.id === character.id ? { ...x, combat_power: newValue } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "전투력 초기화에 실패했어요.");
    } finally {
      setBusyCombatPowerId(null);
    }
  }

  function handleSetMain(character: CharacterRow) {
    setCharacters((prev) =>
      prev.map((x) => {
        if (x.id === character.id) return { ...x, is_main_character: true };
        if (x.expedition_label === character.expedition_label) return { ...x, is_main_character: false };
        return x;
      })
    );
    startTransition(() => {
      setMainCharacter(character.id);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleFetchRoster} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          required
          placeholder="대표 캐릭터명 (예: 홍길동)"
          value={mainName}
          onChange={(e) => setMainName(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <input
          type="text"
          required
          placeholder="원정대 이름 (예: 본계정, 부계정, 부부계정)"
          value={expeditionLabel}
          onChange={(e) => setExpeditionLabel(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {loading ? "불러오는 중..." : "원정대 불러오기"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {roster && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
            등록할 캐릭터를 선택하세요. (아이템레벨 높은 순, 상위 6개 기본 선택) · 원정대 이름:{" "}
            <strong>{expeditionLabel || "미입력"}</strong>
          </p>
          <div className="flex flex-col gap-2">
            {roster.map((r) => (
              <label key={r.CharacterName} className="flex items-center gap-2 text-sm text-neutral-900 dark:text-neutral-100">
                <input
                  type="checkbox"
                  checked={selected.has(r.CharacterName)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(r.CharacterName);
                      else next.delete(r.CharacterName);
                      return next;
                    })
                  }
                />
                <span className="font-medium">{r.CharacterName}</span>
                <span className="text-neutral-400 dark:text-neutral-500">
                  {r.CharacterClassName} · Lv.{r.ItemAvgLevel}
                  {r.CombatPower != null && ` · 전투력 ${r.CombatPower.toLocaleString()}`} · {r.ServerName}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={handleImport}
            disabled={!expeditionLabel.trim()}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            선택한 캐릭터 등록
          </button>
        </div>
      )}

      <div className="flex flex-col gap-6">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">등록된 캐릭터</h2>
        {characters.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">아직 등록된 캐릭터가 없어요.</p>
        ) : (
          groupedCharacters.map(([label, group]) => (
            <div key={label || "__unassigned"}>
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="font-semibold text-neutral-600 dark:text-neutral-400">{label || "원정대 미지정"}</span>
                {group.find((c) => c.is_main_character) && (
                  <span className="text-neutral-400 dark:text-neutral-500">
                    대표: {group.find((c) => c.is_main_character)!.name}
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {group.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                  >
                    <div>
                      <span className="font-medium">
                        {c.is_main_character && <span className="mr-1 text-amber-500">★</span>}
                        {c.name}
                      </span>{" "}
                      <span className="text-neutral-400 dark:text-neutral-500">
                        {c.class} · Lv.{c.item_level?.toLocaleString()}
                        {c.combat_power != null && ` · 전투력 ${c.combat_power.toLocaleString()}`} · {c.server}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleRefreshCombatPower(c)}
                        disabled={busyCombatPowerId === c.id}
                        title="레이드 세팅 기준 최고 전투력을 유지하기 위해, 새로 받은 값이 더 높을 때만 갱신돼요."
                        className="text-xs text-neutral-400 hover:text-neutral-700 disabled:opacity-50 dark:text-neutral-500 dark:hover:text-neutral-200"
                      >
                        {busyCombatPowerId === c.id ? "갱신 중..." : "전투력 갱신"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResetCombatPower(c)}
                        disabled={busyCombatPowerId === c.id}
                        title="스펙이 실제로 다운됐을 때, 저장된 최고 전투력 기록을 지금 값으로 강제로 맞춰요."
                        className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-50 dark:text-neutral-500 dark:hover:text-red-400"
                      >
                        전투력 초기화
                      </button>
                      {!c.is_main_character && (
                        <button
                          type="button"
                          onClick={() => handleSetMain(c)}
                          className="text-xs text-neutral-400 hover:text-amber-500 dark:text-neutral-500"
                        >
                          대표로 설정
                        </button>
                      )}
                      <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                        <input
                          type="checkbox"
                          checked={c.is_gold_earner}
                          onChange={(e) => {
                            const value = e.target.checked;
                            setCharacters((prev) =>
                              prev.map((x) => (x.id === c.id ? { ...x, is_gold_earner: value } : x))
                            );
                            startTransition(() => {
                              toggleGoldEarner(c.id, value);
                            });
                          }}
                        />
                        골드 획득
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setCharacters((prev) => prev.filter((x) => x.id !== c.id));
                          startTransition(() => {
                            deleteCharacter(c.id);
                          });
                        }}
                        className="text-xs text-red-500 hover:underline dark:text-red-400"
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
