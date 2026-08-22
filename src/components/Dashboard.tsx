"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setRaidCheck, refreshAllCombatPower, resetAllCombatPower } from "@/app/actions";
import HomeworkEditor from "@/components/HomeworkEditor";
import CharacterReorderModal from "@/components/CharacterReorderModal";
import { splitGold, difficultyColorClass } from "@/lib/raidDisplay";
import { getClassIcon } from "@/lib/classIcons";
import { isSupportEngraving } from "@/lib/engravings";

const AUTO_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간

type Profile = { id: string; nickname: string };
type CharacterRow = {
  id: string;
  owner_id: string;
  name: string;
  server: string | null;
  class: string | null;
  item_level: number | null;
  combat_power: number | null;
  class_engraving: string | null;
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
  mode,
  currentUserId,
  weekKey,
  profiles,
  characters,
  raids,
  initialChecks,
  initialCharacterRaids,
}: {
  /** "mine": 내 캐릭터만 보여주는 개인 대시보드. "party": 친구 전체를 모아 보는 공용 탭. */
  mode: "mine" | "party";
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
  const [reordering, setReordering] = useState(false);
  const [collapsedProfiles, setCollapsedProfiles] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [combatPowerBusy, setCombatPowerBusy] = useState<"refresh" | "reset" | null>(null);
  const router = useRouter();

  async function handleRefreshAllCombatPower() {
    setCombatPowerBusy("refresh");
    try {
      await refreshAllCombatPower();
      router.refresh();
    } finally {
      setCombatPowerBusy(null);
    }
  }

  // 사용자가 오래 갱신 버튼을 안 눌러도 전투력/레벨이 3시간마다 자동으로 갱신되게 한다.
  // 브라우저별로 마지막 자동 갱신 시각을 기억해뒀다가, 그만큼 지났으면 페이지 열 때 한 번 자동 실행하고,
  // 탭을 오래 켜두는 경우를 위해 그 뒤로도 3시간 간격 타이머를 돌린다.
  useEffect(() => {
    if (mode !== "mine") return;
    const storageKey = `lastCombatPowerRefresh:${currentUserId}`;

    function maybeAutoRefresh() {
      let lastRefresh = 0;
      try {
        lastRefresh = Number(localStorage.getItem(storageKey) ?? 0);
      } catch {
        // 프라이빗 모드 등에서 localStorage가 막혀있으면 그냥 매번 자동 갱신하지 않고 건너뜀
        return;
      }
      if (Date.now() - lastRefresh < AUTO_REFRESH_INTERVAL_MS) return;
      try {
        localStorage.setItem(storageKey, String(Date.now()));
      } catch {
        // 저장 실패해도 갱신 자체는 계속 진행
      }
      setCombatPowerBusy("refresh");
      refreshAllCombatPower()
        .then(() => router.refresh())
        .finally(() => setCombatPowerBusy(null));
    }

    maybeAutoRefresh();
    const interval = setInterval(maybeAutoRefresh, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentUserId]);

  async function handleResetAllCombatPower() {
    const confirmed = window.confirm(
      "내 캐릭터 전체의 저장된 최고 전투력 기록을 지우고, 지금 API 값으로 다시 맞출까요? (스펙이 실제로 다운됐을 때만 사용하세요)"
    );
    if (!confirmed) return;
    setCombatPowerBusy("reset");
    try {
      await resetAllCombatPower();
      router.refresh();
    } finally {
      setCombatPowerBusy(null);
    }
  }

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
      list.sort((a, b) => a.sort_order - b.sort_order);
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
      // 원정대(계정) 순서는 예전처럼 아이템레벨 기준(본계 > 부계 > 부부계) 그대로 유지 — 캐릭터 순서
      // 변경(드래그)은 원정대 "안"에서의 카드 순서만 바꾸고, 어느 원정대가 먼저 오는지는 안 건드린다.
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

  // 로그인한 사람 기준 "내 캐릭터 전체"에서 이번 주에 체크한 레이드 수 / 가야 하는 전체 레이드 수
  const myRaidProgress = useMemo(() => {
    let checked = 0;
    let total = 0;
    for (const character of characters) {
      if (character.owner_id !== currentUserId) continue;
      for (const raid of selectedRaidsFor(character)) {
        total++;
        if (isRaidClearedAtAll(character.id, raid)) checked++;
      }
    }
    return { checked, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters, characterRaidMap, checkedSet, currentUserId]);

  // 레이드 이름별 출시 순서 (여러 난이도가 있어도 그 이름의 가장 이른 sort_order 하나로 대표) — 현황 카드 정렬용
  const raidNameOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of raids) {
      if (!map.has(r.name)) map.set(r.name, r.sort_order);
    }
    return map;
  }, [raids]);

  // 로그인한 사람 기준 "내 캐릭터 전체"에서 레이드 이름별로, 그 안의 난이도별 클리어한 캐릭터 수/전체 수와
  // (골드 받기로 고른 것만) 그 레이드 이름 전체에서 받을 수 있는 골드 합계
  const myRaidStatusByName = useMemo(() => {
    type DifficultyStatus = { difficulty: string; sortOrder: number; done: number; total: number };
    const map = new Map<string, { difficulties: Map<string, DifficultyStatus>; tradeable: number; bound: number }>();
    for (const character of characters) {
      if (character.owner_id !== currentUserId) continue;
      const goldEarningIds = goldEarningRaidIdsFor(character);
      for (const raid of selectedRaidsFor(character)) {
        const entry = map.get(raid.name) ?? { difficulties: new Map(), tradeable: 0, bound: 0 };
        const diffEntry = entry.difficulties.get(raid.difficulty) ?? {
          difficulty: raid.difficulty,
          sortOrder: raid.sort_order,
          done: 0,
          total: 0,
        };
        diffEntry.total++;
        if (isRaidClearedAtAll(character.id, raid)) diffEntry.done++;
        entry.difficulties.set(raid.difficulty, diffEntry);

        if (character.is_gold_earner && goldEarningIds.has(raid.id)) {
          const split = splitGold(raid);
          entry.tradeable += split.tradeable;
          entry.bound += split.bound;
        }
        map.set(raid.name, entry);
      }
    }
    return Array.from(map.entries())
      .map(([raidName, v]) => ({
        raidName,
        difficulties: Array.from(v.difficulties.values()).sort((a, b) => a.sortOrder - b.sortOrder),
        tradeable: v.tradeable,
        bound: v.bound,
      }))
      .sort((a, b) => (raidNameOrder.get(a.raidName) ?? 0) - (raidNameOrder.get(b.raidName) ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters, characterRaidMap, checkedSet, currentUserId, raidNameOrder]);

  function percentOf(earned: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((earned / total) * 100);
  }

  function toggleProfileCollapse(profileId: string) {
    setCollapsedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  // 공격대 탭에서는 내 원정대를 맨 위로 — 등록 순서 그대로면 내 캐릭터가 아래쪽에 묻혀서 찾기 불편했음
  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      return 0;
    });
  }, [profiles, currentUserId]);

  const visibleProfiles = mode === "mine" ? sortedProfiles.filter((p) => p.id === currentUserId) : sortedProfiles;
  const hasAnyVisibleCharacters = visibleProfiles.some((p) => charactersByOwner.has(p.id));

  if (!hasAnyVisibleCharacters) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        {mode === "mine"
          ? "등록된 캐릭터가 없어요. ‘내 캐릭터’에서 먼저 캐릭터를 불러와주세요."
          : "아직 아무도 캐릭터를 등록하지 않았어요."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {mode === "mine" && (
        <>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReordering(true)}
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
            >
              캐릭터 순서 변경
            </button>
            <button
              type="button"
              onClick={handleRefreshAllCombatPower}
              disabled={combatPowerBusy !== null}
              title="레이드 세팅 기준 최고 전투력을 유지하기 위해, 새로 받은 값이 더 높을 때만 갱신돼요. 3시간마다 자동으로도 갱신돼요."
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
            >
              {combatPowerBusy === "refresh" ? "전투력 갱신 중..." : "전투력 전체 갱신"}
            </button>
            <button
              type="button"
              onClick={handleResetAllCombatPower}
              disabled={combatPowerBusy !== null}
              title="스펙이 실제로 다운됐을 때, 저장된 최고 전투력 기록을 지금 값으로 강제로 맞춰요."
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-red-300 hover:text-red-500 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-red-800 dark:hover:text-red-400"
            >
              {combatPowerBusy === "reset" ? "초기화 중..." : "전투력 전체 초기화"}
            </button>
          </div>

          <div className="flex flex-wrap gap-8 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        {(
          [
            {
              label: "남은 레이드",
              earned: myRaidProgress.checked,
              total: myRaidProgress.total,
              textClass: "text-emerald-600 dark:text-emerald-400",
              barClass: "bg-emerald-500",
              trackClass: "bg-emerald-100 dark:bg-emerald-950",
            },
            {
              label: "거래가능 골드",
              earned: myGoldProgress.earnedTradeable,
              total: myGoldProgress.totalTradeable,
              textClass: "text-amber-600 dark:text-amber-400",
              barClass: "bg-amber-500",
              trackClass: "bg-amber-100 dark:bg-amber-950",
            },
            {
              label: "귀속 골드",
              earned: myGoldProgress.earnedBound,
              total: myGoldProgress.totalBound,
              textClass: "text-indigo-600 dark:text-indigo-400",
              barClass: "bg-indigo-500",
              trackClass: "bg-indigo-100 dark:bg-indigo-950",
            },
          ] as const
        ).map((stat) => {
          const pct = percentOf(stat.earned, stat.total);
          return (
            <div key={stat.label} className="min-w-[170px]">
              <div className="mb-1 text-xs text-neutral-400 dark:text-neutral-400">{stat.label}</div>
              <div className="flex items-baseline gap-1 text-sm">
                <span className={`font-semibold ${stat.textClass}`}>{stat.earned.toLocaleString()}</span>
                <span className="text-neutral-400 dark:text-neutral-400">/ {stat.total.toLocaleString()}</span>
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
        </>
      )}

      {myRaidStatusByName.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 text-xs font-semibold text-neutral-500 dark:text-neutral-400">내 레이드별 현황</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {myRaidStatusByName.map(({ raidName, difficulties, tradeable, bound }) => (
              <div
                key={raidName}
                className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-800/50"
              >
                <div className="mb-1.5 font-medium text-neutral-700 dark:text-neutral-300">{raidName}</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {difficulties.map((d) => {
                    const complete = d.done >= d.total;
                    return (
                      <span
                        key={d.difficulty}
                        className="flex items-center gap-1 rounded border border-neutral-200 bg-white px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        <span className={difficultyColorClass(d.difficulty)}>{d.difficulty}</span>
                        <span className={complete ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-500 dark:text-neutral-400"}>
                          {d.done}/{d.total}
                        </span>
                      </span>
                    );
                  })}
                </div>
                {(tradeable > 0 || bound > 0) && (
                  <div className="flex items-center justify-between border-t border-neutral-200 pt-1.5 dark:border-neutral-700">
                    <span className="text-neutral-400 dark:text-neutral-400">받을 수 있는 골드</span>
                    <span className="flex items-center gap-1">
                      {tradeable > 0 && <span className="text-amber-600 dark:text-amber-400">{tradeable.toLocaleString()}G</span>}
                      {tradeable > 0 && bound > 0 && <span className="text-neutral-300 dark:text-neutral-500">/</span>}
                      {bound > 0 && <span className="text-indigo-600 dark:text-indigo-400">{bound.toLocaleString()}G</span>}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {visibleProfiles
        .filter((p) => charactersByOwner.has(p.id))
        .map((profile) => (
          <section
            key={profile.id}
            className={
              mode === "party"
                ? "rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
                : ""
            }
          >
            {mode === "party" ? (
              <button
                type="button"
                onClick={() => toggleProfileCollapse(profile.id)}
                className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
              >
                <span
                  className={[
                    "inline-block text-[10px] text-neutral-400 transition-transform dark:text-neutral-500",
                    collapsedProfiles.has(profile.id) ? "-rotate-90" : "",
                  ].join(" ")}
                >
                  ▼
                </span>
                {profile.nickname}
                {profile.id === currentUserId && (
                  <span className="text-neutral-400 dark:text-neutral-400">(나)</span>
                )}
              </button>
            ) : (
              <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{profile.nickname}</h2>
            )}
            {!collapsedProfiles.has(profile.id) &&
              groupByExpedition(charactersByOwner.get(profile.id)!).map((group, groupIndex, allGroups) => (
              <div key={group.label ?? "__unassigned"} className={groupIndex > 0 ? "mt-4" : ""}>
                {(group.label || allGroups.length > 1) && (
                  <div className="mb-1.5 text-xs font-medium text-neutral-400 dark:text-neutral-400">
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
                      <div key={character.id} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-start gap-2">
                        {(() => {
                          const icon = getClassIcon(character.class);
                          if (!icon) return null;
                          return (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={icon.url}
                              alt={character.class ?? ""}
                              style={{ objectPosition: icon.objectPosition ?? "center top" }}
                              className="h-10 w-10 shrink-0 rounded-full border border-neutral-200 object-cover dark:border-neutral-700"
                            />
                          );
                        })()}
                        <div>
                          <div className="font-medium text-neutral-900 dark:text-neutral-100">
                            {character.is_main_character && <span className="mr-1 text-amber-500">★</span>}
                            {character.name}
                            {character.class_engraving && (
                              <span className="ml-1.5 text-xs font-normal text-neutral-400 dark:text-neutral-400">
                                {character.class_engraving}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-neutral-400 dark:text-neutral-400">
                            {character.class} · Lv.{character.item_level?.toLocaleString() ?? "-"}
                            {character.combat_power != null && (
                              <>
                                {" · "}
                                {character.class_engraving ? (
                                  isSupportEngraving(character.class_engraving) ? (
                                    <span className="font-bold text-[#16a34a] dark:text-[#4ade80]">
                                      +{character.combat_power.toLocaleString()}
                                    </span>
                                  ) : (
                                    <span className="font-bold text-[#e2492a] dark:text-[#ff8a65]">
                                      🗡️{character.combat_power.toLocaleString()}
                                    </span>
                                  )
                                ) : (
                                  `전투력 ${character.combat_power.toLocaleString()}`
                                )}
                              </>
                            )}
                            {!character.is_gold_earner && " · 비골드"}
                          </div>
                        </div>
                      </div>
                      {mine && (
                        <button
                          type="button"
                          onClick={() => setEditingCharacter(character)}
                          className="whitespace-nowrap rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
                        >
                          숙제 편집
                        </button>
                      )}
                    </div>

                    {selectedRaids.length === 0 ? (
                      <p className="text-xs text-neutral-400 dark:text-neutral-400">
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
                                  ? "border-neutral-100 bg-neutral-50 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
                                  : "border-neutral-200 bg-white font-medium text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
                                !eligible ? "opacity-40" : "",
                                mine && eligible ? "cursor-pointer hover:border-emerald-400" : "cursor-default",
                              ].join(" ")}
                            >
                              <span className={["flex items-center gap-1.5", cleared ? "line-through" : ""].join(" ")}>
                                <span
                                  className={[
                                    "flex h-4 w-4 items-center justify-center rounded border text-[10px]",
                                    cleared
                                      ? "border-neutral-300 bg-neutral-200 text-neutral-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-400"
                                      : "border-neutral-300 dark:border-neutral-600",
                                  ].join(" ")}
                                >
                                  {cleared ? "✓" : ""}
                                </span>
                                {raid.name}{" "}
                                <span className={cleared ? "" : difficultyColorClass(raid.difficulty)}>
                                  {raid.difficulty}
                                </span>
                              </span>
                              {noGold ? (
                                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400 dark:bg-neutral-800 dark:text-neutral-400">
                                  골드 없음 (4개 이상 선택)
                                </span>
                              ) : (
                                (() => {
                                  const { bound, tradeable } = splitGold(raid);
                                  return (
                                    <span className={["flex items-center gap-1", cleared ? "line-through" : ""].join(" ")}>
                                      {tradeable > 0 && (
                                        <span className={cleared ? "text-neutral-400 dark:text-neutral-400" : "text-amber-600 dark:text-amber-400"}>
                                          {tradeable.toLocaleString()}G
                                        </span>
                                      )}
                                      {tradeable > 0 && bound > 0 && <span className="text-neutral-300 dark:text-neutral-500">/</span>}
                                      {bound > 0 && (
                                        <span className={cleared ? "text-neutral-400 dark:text-neutral-400" : "text-indigo-600 dark:text-indigo-400"}>
                                          {bound.toLocaleString()}G
                                        </span>
                                      )}
                                    </span>
                                  );
                                })()
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {remaining !== null && selectedRaids.length > 0 && (
                      <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2 text-xs dark:border-neutral-800">
                        <span className="text-neutral-400 dark:text-neutral-400">받을 수 있는 골드</span>
                        <span className="flex items-center gap-1">
                          <span className="text-amber-600 dark:text-amber-400">{remaining.tradeable.toLocaleString()}G</span>
                          <span className="text-neutral-300 dark:text-neutral-500">/</span>
                          <span className="text-indigo-600 dark:text-indigo-400">{remaining.bound.toLocaleString()}G</span>
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

      {reordering && (
        <CharacterReorderModal
          characters={charactersByOwner.get(currentUserId) ?? []}
          onClose={() => setReordering(false)}
          onSaved={() => {
            setReordering(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
