"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { setRaidCheck } from "@/app/actions";
import HomeworkEditor from "@/components/HomeworkEditor";
import { totalGold, splitGold, difficultyColorClass } from "@/lib/raidDisplay";

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
type CharacterRaidRow = { character_id: string; raid_id: string };

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
  initialCharacterRaids,
}: {
  currentUserId: string;
  weekKey: string;
  profiles: Profile[];
  characters: CharacterRow[];
  raids: RaidRow[];
  initialChecks: CheckRow[];
  initialCharacterRaids: CharacterRaidRow[];
}) {
  const [checkedSet, setCheckedSet] = useState<Set<string>>(
    () => new Set(initialChecks.map((c) => checkKey(c.character_id, c.raid_id, c.gate_number)))
  );
  const [characterRaidMap, setCharacterRaidMap] = useState<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    for (const cr of initialCharacterRaids) {
      const set = map.get(cr.character_id) ?? new Set<string>();
      set.add(cr.raid_id);
      map.set(cr.character_id, set);
    }
    return map;
  });
  const [editingCharacter, setEditingCharacter] = useState<CharacterRow | null>(null);
  const [, startTransition] = useTransition();

  // 다른 친구가 체크하거나 숙제를 편집하면 실시간으로 반영
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`dashboard:${weekKey}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "weekly_checks", filter: `week_key=eq.${weekKey}` },
        (payload) => {
          const row = payload.new as CheckRow;
          setCheckedSet((prev) => new Set(prev).add(checkKey(row.character_id, row.raid_id, row.gate_number)));
        }
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "weekly_checks" }, (payload) => {
        const row = payload.old as Partial<CheckRow>;
        if (!row.character_id || !row.raid_id || row.gate_number === undefined) return;
        setCheckedSet((prev) => {
          const next = new Set(prev);
          next.delete(checkKey(row.character_id!, row.raid_id!, row.gate_number!));
          return next;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "character_raids" }, (payload) => {
        const row = payload.new as CharacterRaidRow;
        setCharacterRaidMap((prev) => {
          const next = new Map(prev);
          const set = new Set(next.get(row.character_id) ?? []);
          set.add(row.raid_id);
          next.set(row.character_id, set);
          return next;
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "character_raids" }, (payload) => {
        const row = payload.old as Partial<CharacterRaidRow>;
        if (!row.character_id || !row.raid_id) return;
        setCharacterRaidMap((prev) => {
          const next = new Map(prev);
          const set = new Set(next.get(row.character_id!) ?? []);
          set.delete(row.raid_id!);
          next.set(row.character_id!, set);
          return next;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [weekKey]);

  const charactersByOwner = useMemo(() => {
    const map = new Map<string, CharacterRow[]>();
    for (const c of characters) {
      const list = map.get(c.owner_id) ?? [];
      list.push(c);
      map.set(c.owner_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.item_level ?? 0) - (a.item_level ?? 0));
    }
    return map;
  }, [characters]);

  function isChecked(characterId: string, raidId: string, gate: number) {
    return checkedSet.has(checkKey(characterId, raidId, gate));
  }

  function isRaidClearedAtAll(characterId: string, raid: RaidRow) {
    for (let gate = 1; gate <= raid.gate_count; gate++) {
      if (isChecked(characterId, raid.id, gate)) return true;
    }
    return false;
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
        setCheckedSet((prev) => {
          const next = new Set(prev);
          if (nextChecked) next.delete(key);
          else next.add(key);
          return next;
        });
      });
    });
  }

  function selectedRaidsFor(character: CharacterRow): RaidRow[] {
    const ids = characterRaidMap.get(character.id);
    if (!ids) return [];
    return raids.filter((r) => ids.has(r.id)).sort((a, b) => a.sort_order - b.sort_order);
  }

  function remainingSplitFor(character: CharacterRow): { bound: number; tradeable: number } | null {
    if (!character.is_gold_earner) return null;
    return selectedRaidsFor(character).reduce(
      (acc, raid) => {
        if (isRaidClearedAtAll(character.id, raid)) return acc;
        const split = splitGold(raid);
        return { bound: acc.bound + split.bound, tradeable: acc.tradeable + split.tradeable };
      },
      { bound: 0, tradeable: 0 }
    );
  }

  // 로그인한 사람 기준 "내 캐릭터 전체"에서 아직 받을 수 있는 골드 합계
  const myRemainingTotal = useMemo(() => {
    const totals = { bound: 0, tradeable: 0 };
    for (const character of characters) {
      if (character.owner_id !== currentUserId) continue;
      const split = remainingSplitFor(character);
      if (!split) continue;
      totals.bound += split.bound;
      totals.tradeable += split.tradeable;
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters, characterRaidMap, checkedSet, currentUserId]);

  if (characters.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
        등록된 캐릭터가 없어요. &lsquo;내 캐릭터&rsquo;에서 먼저 캐릭터를 불러와주세요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
        <span className="text-neutral-500">내가 받을 수 있는 골드</span>
        <span>
          <span className="text-amber-600 font-medium">
            거래가능 {myRemainingTotal.tradeable.toLocaleString()}G
          </span>
        </span>
        <span>
          <span className="text-indigo-600 font-medium">귀속 {myRemainingTotal.bound.toLocaleString()}G</span>
        </span>
        <span className="text-neutral-400">
          합계 {(myRemainingTotal.bound + myRemainingTotal.tradeable).toLocaleString()}G
        </span>
      </div>

      {profiles
        .filter((p) => charactersByOwner.has(p.id))
        .map((profile) => (
          <section key={profile.id}>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">
              {profile.nickname}
              {profile.id === currentUserId && <span className="ml-1 text-neutral-400">(나)</span>}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {charactersByOwner.get(profile.id)!.map((character) => {
                const mine = character.owner_id === currentUserId;
                const selectedRaids = selectedRaidsFor(character);
                const remaining = remainingSplitFor(character);
                return (
                  <div key={character.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="font-medium text-neutral-900">{character.name}</div>
                        <div className="text-xs text-neutral-400">
                          {character.class} · Lv.{character.item_level?.toLocaleString() ?? "-"}
                          {character.combat_power != null &&
                            ` · 전투력 ${character.combat_power.toLocaleString()}`}
                          {!character.is_gold_earner && " · 비골드"}
                        </div>
                      </div>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => setEditingCharacter(character)}
                          className="whitespace-nowrap rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800"
                        >
                          숙제 편집
                        </button>
                      )}
                    </div>

                    {selectedRaids.length === 0 ? (
                      <p className="text-xs text-neutral-400">
                        등록된 숙제가 없어요.
                        {mine && " '숙제 편집'으로 추가해보세요."}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {selectedRaids.map((raid) => {
                          const eligible = (character.item_level ?? 0) >= raid.min_item_level;
                          const cleared = isRaidClearedAtAll(character.id, raid);
                          const disabled = !mine || !eligible;
                          return (
                            <button
                              key={raid.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => toggle(character, raid.id, 1)}
                              title={!eligible ? "아이템레벨 미달" : undefined}
                              className={[
                                "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs",
                                cleared
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-neutral-200 bg-white text-neutral-700",
                                !eligible ? "opacity-40" : "",
                                mine && eligible ? "cursor-pointer hover:border-emerald-400" : "cursor-default",
                              ].join(" ")}
                            >
                              <span className="flex items-center gap-1.5">
                                <span
                                  className={[
                                    "flex h-4 w-4 items-center justify-center rounded border text-[10px]",
                                    cleared ? "border-emerald-500 bg-emerald-500 text-white" : "border-neutral-300",
                                  ].join(" ")}
                                >
                                  {cleared ? "✓" : ""}
                                </span>
                                {raid.name} <span className={difficultyColorClass(raid.difficulty)}>{raid.difficulty}</span>
                              </span>
                              <span className="text-neutral-400">{totalGold(raid).toLocaleString()}G</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {remaining !== null && selectedRaids.length > 0 && (
                      <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2 text-xs">
                        <span className="text-neutral-400">받을 수 있는 골드</span>
                        <span className="flex gap-2">
                          <span className="text-amber-600">{remaining.tradeable.toLocaleString()}G</span>
                          <span className="text-indigo-600">{remaining.bound.toLocaleString()}G</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

      {editingCharacter && (
        <HomeworkEditor
          characterId={editingCharacter.id}
          characterName={editingCharacter.name}
          characterItemLevel={editingCharacter.item_level}
          allRaids={raids}
          selectedRaidIds={characterRaidMap.get(editingCharacter.id) ?? new Set()}
          onClose={() => setEditingCharacter(null)}
          onSaved={(newIds) => {
            setCharacterRaidMap((prev) => {
              const next = new Map(prev);
              next.set(editingCharacter.id, newIds);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
