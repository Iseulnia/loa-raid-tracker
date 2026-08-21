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
  expedition_label: string | null;
  is_main_character: boolean;
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
type CharacterRaidRow = { character_id: string; raid_id: string; is_gold_earning: boolean };

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
  // characterId -> (raidId -> 골드 받기로 고른 레이드인지)
  const [characterRaidMap, setCharacterRaidMap] = useState<Map<string, Map<string, boolean>>>(() => {
    const map = new Map<string, Map<string, boolean>>();
    for (const cr of initialCharacterRaids) {
      const inner = map.get(cr.character_id) ?? new Map<string, boolean>();
      inner.set(cr.raid_id, cr.is_gold_earning);
      map.set(cr.character_id, inner);
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
          const inner = new Map(next.get(row.character_id) ?? []);
          inner.set(row.raid_id, row.is_gold_earning);
          next.set(row.character_id, inner);
          return next;
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "character_raids" }, (payload) => {
        const row = payload.old as Partial<CharacterRaidRow>;
        if (!row.character_id || !row.raid_id) return;
        setCharacterRaidMap((prev) => {
          const next = new Map(prev);
          const inner = new Map(next.get(row.character_id!) ?? []);
          inner.delete(row.raid_id!);
          next.set(row.character_id!, inner);
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

  /** 캐릭터가 여러 개면 원정대(expedition_label)별로 묶어서 구분선을 그리기 위한 그룹핑. */
  function groupByExpedition(list: CharacterRow[]): { label: string | null; characters: CharacterRow[] }[] {
    const groups = new Map<string, CharacterRow[]>();
    for (const c of list) {
      const key = c.expedition_label ?? "";
      const group = groups.get(key) ?? [];
      group.push(c);
      groups.set(key, group);
    }
    const entries = Array.from(groups.entries()).map(([key, chars]) => ({
      label: key === "" ? null : key,
      characters: chars,
    }));
    entries.sort((a, b) => {
      if (a.label === null) return 1;
      if (b.label === null) return -1;
      const maxA = Math.max(...a.characters.map((c) => c.item_level ?? 0));
      const maxB = Math.max(...b.characters.map((c) => c.item_level ?? 0));
      return maxB - maxA;
    });
    return entries;
  }

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
    const selections = characterRaidMap.get(character.id);
    if (!selections) return [];
    return raids.filter((r) => selections.has(r.id)).sort((a, b) => a.sort_order - b.sort_order);
  }

  /** 숙제 편집에서 직접 골드 받기로 고른 레이드만 (최대 3개, 캐릭터별로 유저가 직접 선택). */
  function goldEarningRaidIdsFor(character: CharacterRow): Set<string> {
    const selections = characterRaidMap.get(character.id);
    if (!selections) return new Set();
    return new Set(Array.from(selections.entries()).filter(([, goldEarning]) => goldEarning).map(([raidId]) => raidId));
  }

  function remainingSplitFor(character: CharacterRow): { bound: number; tradeable: number } | null {
    if (!character.is_gold_earner) return null;
    const goldEarningIds = goldEarningRaidIdsFor(character);
    return selectedRaidsFor(character).reduce(
      (acc, raid) => {
        if (!goldEarningIds.has(raid.id) || isRaidClearedAtAll(character.id, raid)) return acc;
        const split = splitGold(raid);
        return { bound: acc.bound + split.bound, tradeable: acc.tradeable + split.tradeable };
      },
      { bound: 0, tradeable: 0 }
    );
  }

  // 로그인한 사람 기준 "내 캐릭터 전체"의 획득한 골드 / 총 획득 가능한 골드.
  // 총 획득 가능 골드는 숙제로 고른 레이드 중 실제로 골드가 나오는(캐릭터당 상위 3개) 레이드 기준으로 고정되고,
  // 체크 여부와 상관없이 변하지 않는다.
  const myGoldProgress = useMemo(() => {
    const progress = {
      earnedBound: 0,
      earnedTradeable: 0,
      totalBound: 0,
      totalTradeable: 0,
    };
    for (const character of characters) {
      if (character.owner_id !== currentUserId || !character.is_gold_earner) continue;
      const goldEarningIds = goldEarningRaidIdsFor(character);
      for (const raid of selectedRaidsFor(character)) {
        if (!goldEarningIds.has(raid.id)) continue;
        const split = splitGold(raid);
        progress.totalBound += split.bound;
        progress.totalTradeable += split.tradeable;
        if (isRaidClearedAtAll(character.id, raid)) {
          progress.earnedBound += split.bound;
          progress.earnedTradeable += split.tradeable;
        }
      }
    }
    return progress;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters, characterRaidMap, checkedSet, currentUserId]);

  function percentOf(earned: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((earned / total) * 100);
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
      <div className="flex flex-wrap gap-8 rounded-lg border border-neutral-200 bg-white px-4 py-3">
        {(
          [
            {
              label: "거래가능 골드",
              earned: myGoldProgress.earnedTradeable,
              total: myGoldProgress.totalTradeable,
              textClass: "text-amber-600",
              barClass: "bg-amber-500",
              trackClass: "bg-amber-100",
            },
            {
              label: "귀속 골드",
              earned: myGoldProgress.earnedBound,
              total: myGoldProgress.totalBound,
              textClass: "text-indigo-600",
              barClass: "bg-indigo-500",
              trackClass: "bg-indigo-100",
            },
          ] as const
        ).map((stat) => {
          const pct = percentOf(stat.earned, stat.total);
          return (
            <div key={stat.label} className="min-w-[170px]">
              <div className="mb-1 text-xs text-neutral-400">{stat.label}</div>
              <div className="flex items-baseline gap-1 text-sm">
                <span className={`font-semibold ${stat.textClass}`}>{stat.earned.toLocaleString()}</span>
                <span className="text-neutral-400">/ {stat.total.toLocaleString()}</span>
                <span className={`ml-1 text-xs font-medium ${stat.textClass}`}>{pct}%</span>
              </div>
              <div className={`mt-1.5 h-1.5 w-full rounded-full ${stat.trackClass}`}>
                <div
                  className={`h-1.5 rounded-full ${stat.barClass}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {profiles
        .filter((p) => charactersByOwner.has(p.id))
        .map((profile) => (
          <section key={profile.id}>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">
              {profile.nickname}
              {profile.id === currentUserId && <span className="ml-1 text-neutral-400">(나)</span>}
            </h2>
            {groupByExpedition(charactersByOwner.get(profile.id)!).map((group, groupIndex, allGroups) => (
              <div key={group.label ?? "__unassigned"} className={groupIndex > 0 ? "mt-4" : ""}>
                {(group.label || allGroups.length > 1) && (
                  <div className="mb-1.5 text-xs font-medium text-neutral-400">
                    {group.label ?? "원정대 미지정"}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.characters.map((character) => {
                    const mine = character.owner_id === currentUserId;
                    const selectedRaids = selectedRaidsFor(character);
                    const remaining = remainingSplitFor(character);
                    const goldEarningIds = goldEarningRaidIdsFor(character);
                    return (
                      <div key={character.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="font-medium text-neutral-900">
                          {character.is_main_character && <span className="mr-1 text-amber-500">★</span>}
                          {character.name}
                        </div>
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
                          const noGold = character.is_gold_earner && !goldEarningIds.has(raid.id);
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
                              {noGold ? (
                                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                                  골드 없음 (4개 이상 선택)
                                </span>
                              ) : (
                                <span className="text-neutral-400">{totalGold(raid).toLocaleString()}G</span>
                              )}
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
              </div>
            ))}
          </section>
        ))}

      {editingCharacter && (
        <HomeworkEditor
          characterId={editingCharacter.id}
          characterName={editingCharacter.name}
          characterItemLevel={editingCharacter.item_level}
          allRaids={raids}
          initialSelections={characterRaidMap.get(editingCharacter.id) ?? new Map()}
          onClose={() => setEditingCharacter(null)}
          onSaved={(newSelections) => {
            setCharacterRaidMap((prev) => {
              const next = new Map(prev);
              next.set(editingCharacter.id, newSelections);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
