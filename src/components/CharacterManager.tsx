"use client";

import { useState, useTransition } from "react";
import { importCharacters, toggleGoldEarner, deleteCharacter, type ImportableCharacter } from "@/app/actions";
import type { LostArkSibling } from "@/lib/lostark";
import { parseItemLevel } from "@/lib/lostark";

type CharacterRow = {
  id: string;
  owner_id: string;
  name: string;
  server: string | null;
  class: string | null;
  item_level: number | null;
  is_gold_earner: boolean;
  sort_order: number;
};

export default function CharacterManager({ initialCharacters }: { initialCharacters: CharacterRow[] }) {
  const [mainName, setMainName] = useState("");
  const [roster, setRoster] = useState<LostArkSibling[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [characters, setCharacters] = useState(initialCharacters);
  const [, startTransition] = useTransition();

  async function handleFetchRoster(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setRoster(null);
    try {
      const res = await fetch(`/api/lostark/roster?name=${encodeURIComponent(mainName)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "불러오기 실패");
      setRoster(data.roster);
      setSelected(new Set(data.roster.map((r: LostArkSibling) => r.CharacterName)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!roster) return;
    const toImport: ImportableCharacter[] = roster
      .filter((r) => selected.has(r.CharacterName))
      .map((r) => ({
        name: r.CharacterName,
        server: r.ServerName,
        className: r.CharacterClassName,
        itemLevel: parseItemLevel(r.ItemAvgLevel),
      }));
    await importCharacters(toImport);
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
          is_gold_earner: existing?.is_gold_earner ?? true,
          sort_order: existing?.sort_order ?? prev.length,
        });
      }
      return Array.from(byName.values());
    });
    setRoster(null);
    setMainName("");
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleFetchRoster} className="flex gap-2">
        <input
          type="text"
          required
          placeholder="대표 캐릭터명 (예: 홍길동)"
          value={mainName}
          onChange={(e) => setMainName(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "불러오는 중..." : "원정대 불러오기"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {roster && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="mb-3 text-sm text-neutral-500">등록할 캐릭터를 선택하세요.</p>
          <div className="flex flex-col gap-2">
            {roster.map((r) => (
              <label key={r.CharacterName} className="flex items-center gap-2 text-sm">
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
                <span className="text-neutral-400">
                  {r.CharacterClassName} · {r.ItemAvgLevel} · {r.ServerName}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={handleImport}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
          >
            선택한 캐릭터 등록
          </button>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">등록된 캐릭터</h2>
        {characters.length === 0 ? (
          <p className="text-sm text-neutral-400">아직 등록된 캐릭터가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {characters.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{c.name}</span>{" "}
                  <span className="text-neutral-400">
                    {c.class} · {c.item_level?.toLocaleString()} · {c.server}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs text-neutral-500">
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
                    className="text-xs text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
