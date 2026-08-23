"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setRaidCheck, refreshAllCombatPower, resetAllCombatPower } from "@/app/actions";
import HomeworkEditor from "@/components/HomeworkEditor";
import CharacterReorderModal from "@/components/CharacterReorderModal";
import AnimatedNumber from "@/components/AnimatedNumber";
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
type RaidStatusEntry = {
  raidName: string;
  difficulties: { difficulty: string; sortOrder: number; done: number; total: number }[];
  tradeable: number;
  bound: number;
  everTradeable: number;
  everBound: number;
};

type DifficultyFilter = { raidName: string; difficulty: string };

/** 레이드별 현황 카드 — 공격대 탭에서는 사람별로(접었다 펴는 영역 안에) 하나씩, 대시보드 탭에서는 나만
 *  하나 뜬다. 어느 쪽이든 렌더링 방식은 같아서 컴포넌트로 분리해뒀다. 난이도 배지를 누르면 그 아래 캐릭터
 *  목록이 그 레이드+난이도를 가는 캐릭터만 남도록 필터링된다(같은 배지를 다시 누르면 해제). */
function RaidStatusByNameCard({
  title,
  entries,
  activeFilter,
  onToggleDifficulty,
}: {
  title: string;
  entries: RaidStatusEntry[];
  activeFilter: DifficultyFilter | null;
  onToggleDifficulty: (raidName: string, difficulty: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-3 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{title}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ raidName, difficulties, tradeable, bound, everTradeable, everBound }) => (
          <div
            key={raidName}
            className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-800/50"
          >
            <div className="mb-1.5 font-medium text-neutral-700 dark:text-neutral-300">{raidName}</div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {difficulties.map((d) => {
                const complete = d.done >= d.total;
                const active = activeFilter?.raidName === raidName && activeFilter?.difficulty === d.difficulty;
                return (
                  <button
                    key={d.difficulty}
                    type="button"
                    onClick={() => onToggleDifficulty(raidName, d.difficulty)}
                    title={active ? "눌러서 전체 캐릭터 보기" : `눌러서 ${raidName} ${d.difficulty} 가는 캐릭터만 보기`}
                    className={[
                      "flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors",
                      active
                        ? "border-neutral-900 bg-neutral-900 dark:border-neutral-100 dark:bg-neutral-100"
                        : "border-neutral-200 bg-white hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-500",
                    ].join(" ")}
                  >
                    <span className={active ? "text-white dark:text-neutral-900" : difficultyColorClass(d.difficulty)}>
                      {d.difficulty}
                    </span>
                    <span
                      className={
                        active
                          ? "text-white dark:text-neutral-900"
                          : complete
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-neutral-500 dark:text-neutral-400"
                      }
                    >
                      {d.done}/{d.total}
                    </span>
                  </button>
                );
              })}
            </div>
            {(everTradeable > 0 || everBound > 0) && (
              <div className="flex items-center justify-between border-t border-neutral-200 pt-1.5 dark:border-neutral-700">
                <span className="text-neutral-400 dark:text-neutral-400">받을 수 있는 골드</span>
                <span className="flex items-center gap-1">
                  {everTradeable > 0 && (
                    <AnimatedNumber value={tradeable} format={(n) => `${n.toLocaleString()}G`} className="text-amber-600 dark:text-amber-400" />
                  )}
                  {everTradeable > 0 && everBound > 0 && <span className="text-neutral-300 dark:text-neutral-500">/</span>}
                  {everBound > 0 && (
                    <AnimatedNumber value={bound} format={(n) => `${n.toLocaleString()}G`} className="text-indigo-600 dark:text-indigo-400" />
                  )}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function checkKey(characterId: string, raidId: string, gate: number) {
  return `${characterId}:${raidId}:${gate}`;
}

// 체크를 빠르게 두 번(체크→해제) 누르면 서버로 나가는 두 요청이 순서 보장 없이 따로 날아가서, 네트워크
// 타이밍에 따라 "해제" 요청이 "체크" 요청보다 먼저 서버에 도착해버릴 수 있었다 — 그러면 최종 DB 상태는
// 체크된 채로 남고, 뒤늦게 도착한 Realtime INSERT 이벤트 때문에 화면에서 체크가 잠깐 사라졌다가 다시
// 나타나는 것처럼 보임. (character,raid,gate) 키별로 이전 요청이 끝난 뒤에만 다음 요청을 보내도록 체인을
// 걸어서 항상 사용자가 누른 순서대로 서버에 도착하게 한다. 컴포넌트 인스턴스와 무관하게 요청 자체의 순서만
// 보장하면 되는 값이라 useRef 대신 모듈 스코프에 둔다(렌더와 무관한 값이라 ref 규칙에도 안 걸림).
const pendingCheckChains = new Map<string, Promise<void>>();
// 실패 시 되돌릴지 판단할 때, 그 사이 사용자가 다시 토글해서 더 최신 의도가 생겼으면 되돌리면 안 되므로 기억해둔다.
const desiredCheckStates = new Map<string, boolean>();

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
  const [combatPowerBusy, setCombatPowerBusy] = useState<"refresh" | "reset" | null>(null);
  // 레이드별 현황 카드에서 난이도 배지를 누르면 그 사람의 캐릭터 목록이 해당 레이드+난이도를 가는
  // 캐릭터만 보이게 필터링된다. 사람(profile)별로 독립적으로 필터를 걸 수 있어서 profileId로 구분해둔다.
  const [difficultyFilterByProfile, setDifficultyFilterByProfile] = useState<Map<string, DifficultyFilter>>(new Map());
  const router = useRouter();

  function toggleDifficultyFilter(profileId: string, raidName: string, difficulty: string) {
    setDifficultyFilterByProfile((prev) => {
      const next = new Map(prev);
      const current = next.get(profileId);
      if (current && current.raidName === raidName && current.difficulty === difficulty) {
        next.delete(profileId); // 같은 배지를 다시 누르면 필터 해제 — 전체 캐릭터로 복귀
      } else {
        next.set(profileId, { raidName, difficulty });
      }
      return next;
    });
  }

  function clearDifficultyFilter(profileId: string) {
    setDifficultyFilterByProfile((prev) => {
      const next = new Map(prev);
      next.delete(profileId);
      return next;
    });
  }

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
      "내 캐릭터 전체의 저장된 최고 전투력·아이템 레벨 기록을 지우고, 지금 API 값으로 다시 맞출까요? (스펙이 실제로 다운됐을 때만 사용하세요)"
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
      // 캐릭터 순서 변경 팝업에서 원정대 순서도 바꿀 수 있어서, 그 안의 가장 앞선(작은) sort_order로 정렬
      // (기존 sort_order는 migration_2026-08-23a로 예전 기본 노출 순서와 같아지도록 한 번 정규화해뒀음).
      const minA = Math.min(...a.characters.map((c) => c.sort_order));
      const minB = Math.min(...b.characters.map((c) => c.sort_order));
      return minA - minB;
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

    desiredCheckStates.set(key, nextChecked);

    setCheckedSet((prev) => {
      const next = new Set(prev);
      if (nextChecked) next.add(key);
      else next.delete(key);
      return next;
    });

    // 같은 키에 대한 이전 요청이 아직 안 끝났으면 그걸 기다렸다가 보낸다 — 그래야 체크→해제를 빠르게 눌러도
    // 두 요청이 항상 누른 순서대로 서버에 도착한다.
    const prevChain = pendingCheckChains.get(key) ?? Promise.resolve();
    const chain = prevChain.then(() =>
      setRaidCheck({ characterId: character.id, raidId, gateNumber: gate, checked: nextChecked }).catch(() => {
        // 이 요청이 실패한 사이 사용자가 또 토글해서 더 최신 의도가 생겼으면, 그 최신 의도를 덮어쓰면 안 되므로 되돌리지 않는다.
        if (desiredCheckStates.get(key) !== nextChecked) return;
        setCheckedSet((prev) => {
          const next = new Set(prev);
          if (nextChecked) next.delete(key);
          else next.add(key);
          return next;
        });
      })
    );
    pendingCheckChains.set(key, chain);
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

  // 사람별로(공격대 탭에서는 나뿐 아니라 친구별로도) 레이드 이름별 난이도별 클리어한 캐릭터 수/전체 수와
  // (골드 받기로 고른 것만) 그 레이드 이름에서 "아직 클리어 안 해서 앞으로 받을 수 있는" 골드 합계.
  // 클리어한 것까지 합치면 체크를 해도 숫자가 그대로라 확인하는 의미가 없어서, 남은(미클리어) 것만 더한다.
  const raidStatusByNameByOwner = useMemo(() => {
    type DifficultyStatus = { difficulty: string; sortOrder: number; done: number; total: number };
    type Entry = {
      difficulties: Map<string, DifficultyStatus>;
      tradeable: number;
      bound: number;
      // 골드 유무 표시(테두리 줄 노출 여부)는 "지금 남은 골드"가 아니라 "원래 골드가 나오는 레이드였는지"로
      // 판단한다 — 남은 값 기준으로 하면 마지막 레이드를 체크하는 순간 0으로 바뀌면서 그 자리에서 바로
      // 사라져버려 숫자가 0으로 줄어드는 애니메이션을 볼 새도 없이 통째로 없어져 보임.
      everTradeable: number;
      everBound: number;
    };
    const byOwner = new Map<string, Map<string, Entry>>();
    for (const character of characters) {
      const ownerMap = byOwner.get(character.owner_id) ?? new Map<string, Entry>();
      const goldEarningIds = goldEarningRaidIdsFor(character);
      for (const raid of selectedRaidsFor(character)) {
        const entry = ownerMap.get(raid.name) ?? { difficulties: new Map(), tradeable: 0, bound: 0, everTradeable: 0, everBound: 0 };
        const diffEntry = entry.difficulties.get(raid.difficulty) ?? {
          difficulty: raid.difficulty,
          sortOrder: raid.sort_order,
          done: 0,
          total: 0,
        };
        diffEntry.total++;
        const cleared = isRaidClearedAtAll(character.id, raid);
        if (cleared) diffEntry.done++;
        entry.difficulties.set(raid.difficulty, diffEntry);

        if (character.is_gold_earner && goldEarningIds.has(raid.id)) {
          const split = splitGold(raid);
          entry.everTradeable += split.tradeable;
          entry.everBound += split.bound;
          if (!cleared) {
            entry.tradeable += split.tradeable;
            entry.bound += split.bound;
          }
        }
        ownerMap.set(raid.name, entry);
      }
      byOwner.set(character.owner_id, ownerMap);
    }

    const result = new Map<string, RaidStatusEntry[]>();
    for (const [ownerId, ownerMap] of byOwner) {
      const list = Array.from(ownerMap.entries())
        .map(([raidName, v]) => ({
          raidName,
          difficulties: Array.from(v.difficulties.values()).sort((a, b) => a.sortOrder - b.sortOrder),
          tradeable: v.tradeable,
          bound: v.bound,
          everTradeable: v.everTradeable,
          everBound: v.everBound,
        }))
        .sort((a, b) => (raidNameOrder.get(a.raidName) ?? 0) - (raidNameOrder.get(b.raidName) ?? 0));
      result.set(ownerId, list);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters, characterRaidMap, checkedSet, raidNameOrder]);

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
              title="레이드 세팅 기준 최고 전투력·아이템 레벨을 유지하기 위해, 새로 받은 값이 더 높을 때만 갱신돼요. 3시간마다 자동으로도 갱신돼요."
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
            >
              {combatPowerBusy === "refresh" ? "전투력·레벨 갱신 중..." : "전투력·레벨 전체 갱신"}
            </button>
            <button
              type="button"
              onClick={handleResetAllCombatPower}
              disabled={combatPowerBusy !== null}
              title="스펙이 실제로 다운됐을 때, 저장된 최고 전투력·아이템 레벨 기록을 지금 값으로 강제로 맞춰요."
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-red-300 hover:text-red-500 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-red-800 dark:hover:text-red-400"
            >
              {combatPowerBusy === "reset" ? "초기화 중..." : "전투력·레벨 전체 초기화"}
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
                <AnimatedNumber value={stat.earned} className={`font-semibold ${stat.textClass}`} />
                <span className="text-neutral-400 dark:text-neutral-400">
                  / <AnimatedNumber value={stat.total} />
                </span>
                <span className={`ml-1 text-xs font-medium ${stat.textClass}`}>{pct}%</span>
              </div>
              <div className={`mt-1.5 h-1.5 w-full rounded-full ${stat.trackClass}`}>
                <div
                  className={`h-1.5 rounded-full ${stat.barClass} transition-[width] duration-500 ease-out`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
          </div>
        </>
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
            {!collapsedProfiles.has(profile.id) && (
              <RaidStatusByNameCard
                title={profile.id === currentUserId ? "내 레이드별 현황" : `${profile.nickname}의 레이드별 현황`}
                entries={raidStatusByNameByOwner.get(profile.id) ?? []}
                activeFilter={difficultyFilterByProfile.get(profile.id) ?? null}
                onToggleDifficulty={(raidName, difficulty) => toggleDifficultyFilter(profile.id, raidName, difficulty)}
              />
            )}
            {!collapsedProfiles.has(profile.id) && difficultyFilterByProfile.has(profile.id) && (
              <button
                type="button"
                onClick={() => clearDifficultyFilter(profile.id)}
                className="mb-2 text-xs text-neutral-400 underline hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
              >
                {difficultyFilterByProfile.get(profile.id)!.raidName} {difficultyFilterByProfile.get(profile.id)!.difficulty}{" "}
                미체크 캐릭터만 보는 중 · 전체 캐릭터 보기
              </button>
            )}
            {!collapsedProfiles.has(profile.id) &&
              groupByExpedition(
                (() => {
                  const filter = difficultyFilterByProfile.get(profile.id);
                  const profileCharacters = charactersByOwner.get(profile.id)!;
                  if (!filter) return profileCharacters;
                  // 그 레이드+난이도를 숙제로 고른 것뿐 아니라, 아직 이번 주에 그걸 안(못) 간 캐릭터만
                  // 남긴다 — "누가 아직 안 갔는지" 확인하기 위한 필터라서 이미 체크된 캐릭터는 빼야 함.
                  return profileCharacters.filter((c) =>
                    selectedRaidsFor(c).some(
                      (r) => r.name === filter.raidName && r.difficulty === filter.difficulty && !isRaidClearedAtAll(c.id, r)
                    )
                  );
                })()
              ).map((group, groupIndex, allGroups) => (
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
                                "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors duration-300 ease-out",
                                cleared
                                  ? "border-neutral-100 bg-neutral-50 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
                                  : "border-neutral-200 bg-white font-medium text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
                                !eligible ? "opacity-40" : "",
                                mine && eligible ? "cursor-pointer hover:border-emerald-400" : "cursor-default",
                              ].join(" ")}
                            >
                              <span className={["flex items-center gap-1.5 transition-colors duration-300 ease-out", cleared ? "line-through" : ""].join(" ")}>
                                <span
                                  className={[
                                    "flex h-4 w-4 items-center justify-center rounded border text-[10px] transition-colors duration-300 ease-out",
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
                                    <span className={["flex items-center gap-1 transition-colors duration-300 ease-out", cleared ? "line-through" : ""].join(" ")}>
                                      {tradeable > 0 && (
                                        <span
                                          className={[
                                            "transition-colors duration-300 ease-out",
                                            cleared ? "text-neutral-400 dark:text-neutral-400" : "text-amber-600 dark:text-amber-400",
                                          ].join(" ")}
                                        >
                                          {tradeable.toLocaleString()}G
                                        </span>
                                      )}
                                      {tradeable > 0 && bound > 0 && <span className="text-neutral-300 dark:text-neutral-500">/</span>}
                                      {bound > 0 && (
                                        <span
                                          className={[
                                            "transition-colors duration-300 ease-out",
                                            cleared ? "text-neutral-400 dark:text-neutral-400" : "text-indigo-600 dark:text-indigo-400",
                                          ].join(" ")}
                                        >
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
                          <AnimatedNumber
                            value={remaining.tradeable}
                            format={(n) => `${n.toLocaleString()}G`}
                            className="text-amber-600 dark:text-amber-400"
                          />
                          <span className="text-neutral-300 dark:text-neutral-500">/</span>
                          <AnimatedNumber
                            value={remaining.bound}
                            format={(n) => `${n.toLocaleString()}G`}
                            className="text-indigo-600 dark:text-indigo-400"
                          />
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
