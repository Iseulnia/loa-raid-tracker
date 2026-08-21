"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { setRaidCheck } from "@/app/actions";

type Profile = { id: string; nickname: string };
type CharacterRow = {
  id: string;
  owner_id: string;
  name: string;
  server: string | null;
  class: string | null;
  item_level: number | null;
  combat_power: number | null;
  is_gold_earner: boolean;
  sort_order: number;
};
type RaidRow = {
  id: string;
  name: string;
  difficulty: string;
  min_item_level: number;
  gate_count: number;
  gold_per_gate: number[];
  sort_order: number;
};
type CheckRow = {
  id: string;
  character_id: string;
  raid_id: string;
  gate_number: number;
  week_key: string;
  checked_by: string;
};

function checkKey(characterId: string, raidId: string, gate: number) {
  return `${characterId}:${raidId}:${gate}`;
}

export default function Dashboard({
  currentUserId,
  weekKey,
  profiles,
  characters,
  raids,
  initialChecks,
}: {
  currentUserId: string;
  weekKey: string;
  profiles: Profile[];
  characters: CharacterRow[];
  raids: RaidRow[];
  initialChecks: CheckRow[];
}) {
  const [checkedSet, setCheckedSet] = useState<Set<string>>(
    () => new Set(initialChecks.map((c) => checkKey(c.character_id, c.raid_id, c.gate_number)))
  );
  const [, startTransition] = useTransition();

  // 다른 친구가 체크하면 실시간으로 반영
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`weekly_checks:${weekKey}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "weekly_checks", filter: `week_key=eq.${weekKey}` },
        (payload) => {
          const row = payload.new as CheckRow;
          setCheckedSet((prev) => new Set(prev).add(checkKey(row.character_id, row.raid_id, row.gate_number)));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "weekly_checks" },
        (payload) => {
          const row = payload.old as Partial<CheckRow>;
          if (!row.character_id || !row.raid_id || row.gate_number === undefined) return;
          setCheckedSet((prev) => {
            const next = new Set(prev);
            next.delete(checkKey(row.character_id!, row.raid_id!, row.gate_number!));
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [weekKey]);

  const columns = useMemo(
    () =>
      raids.flatMap((raid) =>
        Array.from({ length: raid.gate_count }, (_, i) => ({
          raid,
          gate: i + 1,
          gold: raid.gold_per_gate[i] ?? 0,
        }))
      ),
    [raids]
  );

  const charactersByOwner = useMemo(() => {
    const map = new Map<string, CharacterRow[]>();
    for (const c of characters) {
      const list = map.get(c.owner_id) ?? [];
      list.push(c);
      map.set(c.owner_id, list);
    }
    // 아이템레벨 높은 순으로 정렬
    for (const list of map.values()) {
      list.sort((a, b) => (b.item_level ?? 0) - (a.item_level ?? 0));
    }
    return map;
  }, [characters]);

  function isChecked(characterId: string, raidId: string, gate: number) {
    return checkedSet.has(checkKey(characterId, raidId, gate));
  }

  function toggle(character: CharacterRow, raidId: string, gate: number) {
    if (character.owner_id !== currentUserId) return; // 남의 캐릭터는 읽기 전용
    const key = checkKey(character.id, raidId, gate);
    const nextChecked = !checkedSet.has(key);

    setCheckedSet((prev) => {
      const next = new Set(prev);
      if (nextChecked) next.add(key);
      else next.delete(key);
      return next;
    });

    startTransition(() => {
      setRaidCheck({ characterId: character.id, raidId, gateNumber: gate, checked: nextChecked }).catch(() => {
        // 실패하면 되돌림
        setCheckedSet((prev) => {
          const next = new Set(prev);
          if (nextChecked) next.delete(key);
          else next.add(key);
          return next;
        });
      });
    });
  }

  function goldEarnedFor(character: CharacterRow) {
    if (!character.is_gold_earner) return 0;
    return columns.reduce((sum, col) => {
      return isChecked(character.id, col.raid.id, col.gate) ? sum + col.gold : sum;
    }, 0);
  }

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
        등록된 레이드가 없어요. &lsquo;레이드 관리&rsquo;에서 먼저 추가해주세요.
      </p>
    );
  }

  if (characters.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
        등록된 캐릭터가 없어요. &lsquo;내 캐릭터&rsquo;에서 먼저 캐릭터를 불러와주세요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {profiles
        .filter((p) => charactersByOwner.has(p.id))
        .map((profile) => (
          <section key={profile.id}>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">
              {profile.nickname}
              {profile.id === currentUserId && <span className="ml-1 text-neutral-400">(나)</span>}
            </h2>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                    <th className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 font-medium">캐릭터</th>
                    {columns.map((col) => (
                      <th key={`${col.raid.id}-${col.gate}`} className="whitespace-nowrap px-3 py-2 text-center font-medium">
                        {col.raid.name} {col.raid.difficulty}
                        <div className="text-[11px] text-neutral-400">{col.gate}관문</div>
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">예상 골드</th>
                  </tr>
                </thead>
                <tbody>
                  {charactersByOwner
                    .get(profile.id)!
                    .map((character) => (
                      <tr key={character.id} className="border-b border-neutral-100 last:border-0">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2">
                          <div className="font-medium">{character.name}</div>
                          <div className="text-xs text-neutral-400">
                            {character.class} · Lv.{character.item_level?.toLocaleString() ?? "-"}
                            {character.combat_power != null &&
                              ` · 전투력 ${character.combat_power.toLocaleString()}`}
                            {!character.is_gold_earner && " · 비골드"}
                          </div>
                        </td>
                        {columns.map((col) => {
                          const eligible = (character.item_level ?? 0) >= col.raid.min_item_level;
                          const checked = isChecked(character.id, col.raid.id, col.gate);
                          const mine = character.owner_id === currentUserId;
                          return (
                            <td key={`${col.raid.id}-${col.gate}`} className="px-3 py-2 text-center">
                              <button
                                type="button"
                                disabled={!mine || !eligible}
                                onClick={() => toggle(character, col.raid.id, col.gate)}
                                title={!eligible ? "아이템레벨 미달" : undefined}
                                className={[
                                  "h-6 w-6 rounded border text-xs",
                                  checked
                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                    : "border-neutral-300 bg-white",
                                  !eligible ? "opacity-30" : "",
                                  mine && eligible ? "cursor-pointer hover:border-emerald-400" : "cursor-default",
                                ].join(" ")}
                              >
                                {checked ? "✓" : ""}
                              </button>
                            </td>
                          );
                        })}
                        <td className="whitespace-nowrap px-3 py-2 text-right text-neutral-600">
                          {goldEarnedFor(character).toLocaleString()}G
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}
