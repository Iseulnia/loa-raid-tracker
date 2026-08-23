"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setRaidCheck } from "@/app/actions";
import {
  recognizeRegionText,
  recognizeParticipationPanel,
  matchCharacterName,
  SCREEN_CAPTURE_VIDEO_CONSTRAINTS,
  type CropPct,
} from "@/lib/ocrMatch";

type CharacterOption = { id: string; name: string; item_level: number | null };
type RaidOption = { id: string; name: string; difficulty: string };
type CharacterRaidRow = { character_id: string; raid_id: string };
/** 캐릭터 이름이 뜨는 화면 영역 하나(누구 이름이든 그때그때 OCR로 읽어서 매칭하므로 캐릭터별로 여러 개 필요 없음). */
type CharacterNameRegion = { id: string; crop: CropPct };

const PANEL_SCAN_INTERVAL_MS = 2000; // 패널 전체를 OCR로 읽는 주기 (여러 줄을 한 번에 읽어서 이름표별 스캔보다 느림)

// "seen"은 레이드 이름은 인식했지만 아직 참여 완료가 아닌 상태(= 스캔이 그 행을 제대로 보고는 있다는 증거).
// "applied"로 넘어가야 실제로 클리어로 체크된 것.
type FoundStatus = "seen" | "checking" | "applied" | "not-in-homework" | "failed" | "undone";
type FoundEntry = {
  key: string; // `${characterId}:${raidLabel}` — 캐릭터를 전환해도 서로 안 겹치게
  characterId: string;
  characterName: string;
  raidLabel: string;
  status: FoundStatus;
  errorMessage?: string;
  raidId?: string;
};

const STATUS_LABEL: Record<FoundStatus, string> = {
  seen: "클리어 X",
  checking: "확인 중...",
  applied: "클리어",
  "not-in-homework": "클리어 (이 캐릭터 숙제에 없어 체크 안 됨)",
  failed: "체크 실패",
  undone: "체크 취소됨",
};

type OcrStatus = "idle" | "recognizing" | "matched" | "no-match";

export default function StatusPanelScanner({
  characters,
  raids,
  characterRaids,
  panelRegion,
  characterNameRegions,
}: {
  characters: CharacterOption[];
  raids: RaidOption[];
  characterRaids: CharacterRaidRow[];
  /** "레이드 참여 현황" 패널 전체가 보이는 영역 (한 번만 등록, 없으면 스캔 자체를 못 함). */
  panelRegion: CropPct | null;
  characterNameRegions: CharacterNameRegion[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // setInterval에 등록한 콜백은 startScan()을 호출한 그 순간의 runPanelScan 클로저를 영원히 붙잡고 있어서,
  // 스캔 도중 컴포넌트가 리렌더되면(캐릭터/레이드 목록 등 props가 새로 내려와도) 계속 옛날 클로저로 돌아가는
  // 문제가 있었다. ref에 매 렌더마다 최신 함수를 담아두고, 인터벌은 항상 이 ref를 통해서만 호출한다.
  const runPanelScanRef = useRef<() => Promise<void>>(async () => {});
  const ocrBusyRef = useRef(false); // 패널 스캔과 캐릭터 인식이 같은 tesseract 워커를 공유해서 겹치지 않게 함
  const foundKeysRef = useRef<Set<string>>(new Set());
  const characterLockedRef = useRef(false); // 사용자가 수동으로 캐릭터를 고르면 true — 그 뒤로는 자동 인식이 안 덮어씀
  const selectedCharacterIdRef = useRef("");

  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id ?? "");
  const [autoDetectedCharacterId, setAutoDetectedCharacterId] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>("idle");
  useEffect(() => {
    selectedCharacterIdRef.current = selectedCharacterId;
  }, [selectedCharacterId]);

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<FoundEntry[]>([]);

  const charactersById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const distinctRaidLabels = useMemo(() => Array.from(new Set(raids.map((r) => r.name))), [raids]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // characterId -> (레이드 이름 -> 그 캐릭터가 숙제로 선택한 난이도의 raid_id)
  const raidIdByCharacterAndName = useMemo(() => {
    const raidsById = new Map(raids.map((r) => [r.id, r]));
    const map = new Map<string, Map<string, string>>();
    for (const cr of characterRaids) {
      const raid = raidsById.get(cr.raid_id);
      if (!raid) continue;
      const inner = map.get(cr.character_id) ?? new Map<string, string>();
      inner.set(raid.name, cr.raid_id);
      map.set(cr.character_id, inner);
    }
    return map;
  }, [raids, characterRaids]);

  function selectCharacterManually(characterId: string) {
    selectedCharacterIdRef.current = characterId;
    setSelectedCharacterId(characterId);
    setAutoDetectedCharacterId(null);
    characterLockedRef.current = true; // 수동으로 고르면 자동 인식이 덮어쓰지 않게
  }

  /** 캐릭터 이름 영역을 다시 읽어서 selectedCharacterIdRef를 최신으로 맞춘다. runPanelScan()의 맨 앞에서
   *  매번 호출한다 — 별도 타이머로 따로 돌리면, 그 텀 사이에 캐릭터를 바꾸고 바로 스크롤해버릴 경우 이전
   *  캐릭터로 레이드가 잘못 체크되는 문제가 있었음(호출자가 ocrBusyRef를 관리하므로 여기선 안 건드림). */
  async function verifyCharacter(video: HTMLVideoElement) {
    const region = characterNameRegions[0];
    if (!region || characterLockedRef.current || video.videoWidth === 0) return;

    setOcrStatus("recognizing");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const text = await recognizeRegionText(canvas, canvas.width, canvas.height, region.crop, "line");
      const matched = matchCharacterName(text, characters);

      if (characterLockedRef.current) return; // OCR 처리 중 사용자가 수동으로 골랐으면 무시

      if (matched) {
        if (matched.id !== selectedCharacterIdRef.current) {
          selectedCharacterIdRef.current = matched.id;
          setSelectedCharacterId(matched.id);
        }
        setAutoDetectedCharacterId(matched.id);
        setOcrStatus("matched");
      } else {
        setOcrStatus("no-match");
      }
    } catch {
      setOcrStatus("no-match");
    }
  }

  async function startScan() {
    setError("");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("이 브라우저는 화면공유를 지원하지 않아요.");
      return;
    }
    if (!selectedCharacterId) {
      setError("먼저 캐릭터를 선택해주세요.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_CAPTURE_VIDEO_CONSTRAINTS, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      foundKeysRef.current = new Set();
      characterLockedRef.current = false; // 새 스캔을 시작할 때마다 자동 인식에 다시 기회를 준다
      // (전에 수동으로 캐릭터를 골랐던 게 계속 남아있으면, 스캔을 껐다 켜도 영원히 자동 인식이 안 됨)
      setAutoDetectedCharacterId(null);
      setOcrStatus("idle");
      setFound([]);
      setScanning(true);
      stream.getVideoTracks()[0]?.addEventListener("ended", stopScan);
      void runPanelScanRef.current();
      intervalRef.current = setInterval(() => void runPanelScanRef.current(), PANEL_SCAN_INTERVAL_MS);
    } catch {
      setError("화면공유를 시작하지 못했어요 (권한을 거부했거나 취소했을 수 있어요).");
    }
  }

  function stopScan() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }

  async function runPanelScan() {
    const video = videoRef.current;
    const canvasEl = canvasRef.current;
    if (!video || !canvasEl || video.videoWidth === 0 || !panelRegion || ocrBusyRef.current) return;

    ocrBusyRef.current = true;
    try {
      // 레이드를 체크하기 직전에 항상 캐릭터부터 다시 확인한다 — 따로 도는 타이머에만 맡기면, 그 텀 사이에
      // 게임에서 캐릭터를 바꾸고 바로 스크롤해버릴 경우 이전 캐릭터로 잘못 체크되는 문제가 있었음.
      await verifyCharacter(video);

      const characterId = selectedCharacterIdRef.current;
      if (!characterId) return;
      const characterName = charactersById.get(characterId)?.name ?? "";

      canvasEl.width = video.videoWidth;
      canvasEl.height = video.videoHeight;
      const ctx = canvasEl.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvasEl.width, canvasEl.height);

      const rows = await recognizeParticipationPanel(canvasEl, canvasEl.width, canvasEl.height, panelRegion, distinctRaidLabels);

      for (const row of rows) {
        const key = `${characterId}:${row.raidLabel}`;
        if (foundKeysRef.current.has(key)) continue; // 이 캐릭터의 이 레이드는 이미 처리 끝남

        if (!row.cleared) {
          markSeen(characterId, characterName, row.raidLabel);
          continue;
        }

        foundKeysRef.current.add(key);
        // await로 순차 처리 — 한 틱에 여러 레이드가 한꺼번에 클리어로 잡히면 setRaidCheck 서버 액션이
        // 동시에 여러 개 날아가면서 가끔 렌더링이 깨지는(React #441) 문제가 있었음.
        await applyFound(characterId, characterName, row.raidLabel);
      }
    } catch {
      // 이번 틱은 실패해도 다음 틱에 다시 시도
    } finally {
      ocrBusyRef.current = false;
    }
  }

  useEffect(() => {
    runPanelScanRef.current = runPanelScan;
  });

  function upsertEntry(
    key: string,
    base: { characterId: string; characterName: string; raidLabel: string },
    statusPatch: Partial<FoundEntry>
  ) {
    setFound((prev) => {
      const idx = prev.findIndex((f) => f.key === key);
      if (idx === -1) return [...prev, { key, ...base, status: "checking", ...statusPatch } as FoundEntry];
      const next = [...prev];
      next[idx] = { ...next[idx], ...statusPatch };
      return next;
    });
  }

  /** 이름은 인식됐지만 아직 클리어(참여 완료)는 아닌 상태를 목록에 표시/갱신한다. */
  function markSeen(characterId: string, characterName: string, raidLabel: string) {
    const key = `${characterId}:${raidLabel}`;
    setFound((prev) => {
      if (prev.some((f) => f.key === key)) return prev; // 이미 목록에 있으면 그대로 둠 (checking/applied가 덮어씀)
      return [...prev, { key, characterId, characterName, raidLabel, status: "seen" }];
    });
  }

  async function applyFound(characterId: string, characterName: string, raidLabel: string) {
    const key = `${characterId}:${raidLabel}`;
    const base = { characterId, characterName, raidLabel };
    upsertEntry(key, base, { status: "checking" });
    const raidId = raidIdByCharacterAndName.get(characterId)?.get(raidLabel);
    if (!raidId) {
      upsertEntry(key, base, { status: "not-in-homework" });
      return;
    }
    try {
      await setRaidCheck({ characterId, raidId, gateNumber: 1, checked: true });
      upsertEntry(key, base, { status: "applied", raidId, errorMessage: undefined });
    } catch {
      // 아주 가끔 서버 액션 처리 중 일시적인 렌더링 오류(React #441)로 실패하는 경우가 있어서,
      // 잠깐 쉬었다가 한 번 더 시도해본다 — 대부분 재시도하면 바로 성공함.
      try {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await setRaidCheck({ characterId, raidId, gateNumber: 1, checked: true });
        upsertEntry(key, base, { status: "applied", raidId, errorMessage: undefined });
      } catch (err) {
        upsertEntry(key, base, { status: "failed", errorMessage: err instanceof Error ? err.message : undefined });
      }
    }
  }

  /** 오탐으로 체크됐을 때 되돌리기. 같은 스캔 세션 동안은 foundKeysRef에 그대로 남겨둬서 곧바로 다시 자동
   *  체크되지 않게 한다 (다시 체크하려면 새로 스캔을 시작하거나 대시보드에서 직접 체크하면 됨). 서버 응답을
   *  기다렸다가 화면을 바꾸면 체감 지연이 커서, 먼저 화면부터 바꾸고 실패하면 되돌린다(낙관적 업데이트). */
  async function undoFound(entry: FoundEntry) {
    if (!entry.raidId) return;
    const base = { characterId: entry.characterId, characterName: entry.characterName, raidLabel: entry.raidLabel };
    upsertEntry(entry.key, base, { status: "undone" });
    try {
      await setRaidCheck({ characterId: entry.characterId, raidId: entry.raidId, gateNumber: 1, checked: false });
    } catch (err) {
      upsertEntry(entry.key, base, { status: "applied" });
      setError(err instanceof Error ? err.message : "취소 중 오류가 발생했어요.");
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedCharacterId}
          onChange={(e) => selectCharacterManually(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          {characters.length === 0 && <option value="">캐릭터 없음</option>}
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {autoDetectedCharacterId === selectedCharacterId && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-400">
            OCR로 자동 인식됨
          </span>
        )}
        {scanning && ocrStatus === "recognizing" && (
          <span className="text-xs text-neutral-400 dark:text-neutral-400">캐릭터 이름 인식 중...</span>
        )}
        {scanning && ocrStatus === "no-match" && (
          <span className="text-xs text-neutral-400 dark:text-neutral-400">자동 인식 실패 — 직접 선택해주세요</span>
        )}

        {!scanning ? (
          <button
            type="button"
            onClick={startScan}
            disabled={characters.length === 0 || !panelRegion}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            스캔 시작
          </button>
        ) : (
          <button
            type="button"
            onClick={stopScan}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            스캔 종료
          </button>
        )}

        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {scanning ? "스캔 중... 캐릭터를 바꿔가며 참여 현황 패널을 스크롤해주세요." : "대기 중"}
        </span>
      </div>

      {!panelRegion && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          아직 &ldquo;레이드 참여현황 패널 인식 영역&rdquo;이 등록되지 않았어요. 아래에서 먼저 추가해주세요.
        </p>
      )}
      {characterNameRegions.length === 0 && (
        <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-400">
          캐릭터 이름 인식 영역을 등록해두면 캐릭터를 직접 고르지 않아도 OCR로 자동 인식돼요 (선택 사항). 등록해두면
          스캔 중 캐릭터를 바꿔도 자동으로 따라가요.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className={["relative", scanning ? "" : "hidden"].join(" ")}>
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full rounded-md border border-neutral-200 bg-neutral-900 dark:border-neutral-800"
        />
        {/* 지금 OCR이 실제로 보고 있는 영역이 화면 어디인지 눈으로 바로 확인할 수 있도록 겹쳐 그린다 —
            등록한 크롭이 실제 게임 화면 요소와 안 맞아도 여기서 바로 티가 나서 디버깅하기 쉬워짐. */}
        {panelRegion && (
          <div
            className="pointer-events-none absolute border-2 border-emerald-400"
            style={{
              left: `${panelRegion.xPct * 100}%`,
              top: `${panelRegion.yPct * 100}%`,
              width: `${panelRegion.wPct * 100}%`,
              height: `${panelRegion.hPct * 100}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-emerald-500 px-1 text-[10px] font-medium text-white">
              참여현황 패널 인식 영역
            </span>
          </div>
        )}
        {characterNameRegions[0] && (
          <div
            className="pointer-events-none absolute border-2 border-sky-400"
            style={{
              left: `${characterNameRegions[0].crop.xPct * 100}%`,
              top: `${characterNameRegions[0].crop.yPct * 100}%`,
              width: `${characterNameRegions[0].crop.wPct * 100}%`,
              height: `${characterNameRegions[0].crop.hPct * 100}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-sky-500 px-1 text-[10px] font-medium text-white">
              캐릭터 이름 인식 영역
            </span>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {found.length > 0 && (
        <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">인식된 레이드</h3>
          <ul className="flex flex-col gap-1.5">
            {found.map((f) => (
              <li
                key={f.key}
                className={[
                  "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs",
                  f.status === "applied"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400"
                    : f.status === "checking" || f.status === "seen"
                      ? "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
                      : f.status === "undone"
                        ? "border-neutral-200 bg-neutral-50 text-neutral-400 line-through dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
                        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
                ].join(" ")}
              >
                <span>{f.characterName ? `${f.characterName} · ${f.raidLabel}` : f.raidLabel}</span>
                <span className="flex items-center gap-2">
                  {f.errorMessage ? `${STATUS_LABEL[f.status]}: ${f.errorMessage}` : STATUS_LABEL[f.status]}
                  {f.status === "applied" && (
                    <button type="button" onClick={() => undoFound(f)} className="text-red-500 hover:underline dark:text-red-400">
                      취소
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
