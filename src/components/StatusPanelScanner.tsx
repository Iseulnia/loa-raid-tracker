"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setRaidCheck } from "@/app/actions";
import { findBestRowMatch, sampleBadgeRegion, sampleNameTemplate, greenFraction, type CropPct } from "@/lib/rowScan";
import { recognizeRegionText, matchCharacterName } from "@/lib/ocrMatch";

type CharacterOption = { id: string; name: string; item_level: number | null };
type RaidOption = { id: string; name: string; difficulty: string };
type CharacterRaidRow = { character_id: string; raid_id: string };
type StatusRowTemplate = { id: string; raidLabel: string; crop: CropPct; badgeCrop: CropPct; url: string };
/** 캐릭터 이름이 뜨는 화면 영역 하나(누구 이름이든 그때그때 OCR로 읽어서 매칭하므로 캐릭터별로 여러 개 필요 없음). */
type CharacterNameRegion = { id: string; crop: CropPct };

// 결과화면 매칭(88%)보다는 관대하게 — 이름표 텍스트 자체가 작고, 목록 스크롤 중이라 프레임이 살짝
// 흔들릴 수 있어서 너무 빡빡하면 아예 못 찾을 수 있음. 실사용하며 조정 필요할 수 있음.
const NAME_MATCH_THRESHOLD = 0.85;
const BADGE_GREEN_THRESHOLD = 0.12;
const SCAN_INTERVAL_MS = 900;

// "seen"은 레이드 이름은 인식했지만 아직 참여 완료 배지가 아닌 상태(= 스캔이 그 행을 제대로 보고는
// 있다는 증거). "applied"로 넘어가야 실제로 클리어로 체크된 것.
type FoundStatus = "seen" | "checking" | "applied" | "not-in-homework" | "failed" | "undone";
type FoundEntry = {
  raidLabel: string;
  status: FoundStatus;
  errorMessage?: string;
  raidId?: string;
  characterId?: string;
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
  templates,
  characterNameRegions,
}: {
  characters: CharacterOption[];
  raids: RaidOption[];
  characterRaids: CharacterRaidRow[];
  templates: StatusRowTemplate[];
  characterNameRegions: CharacterNameRegion[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ocrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const nameSampleCacheRef = useRef<Map<string, ImageData>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const foundLabelsRef = useRef<Set<string>>(new Set());
  const characterLockedRef = useRef(false);
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

  useEffect(() => {
    for (const t of templates) {
      if (imagesRef.current.has(t.id)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = t.url;
      imagesRef.current.set(t.id, img);
    }
  }, [templates]);

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

  async function attemptCharacterOcr() {
    const region = characterNameRegions[0];
    const video = videoRef.current;
    const ocrCanvas = ocrCanvasRef.current;
    if (!region || !video || !ocrCanvas) return;

    setOcrStatus("recognizing");
    try {
      // 화면공유 시작 직후엔 아직 비디오 프레임이 준비 안 됐을 수 있어서 살짝 기다린다.
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (video.videoWidth === 0) await new Promise((resolve) => setTimeout(resolve, 800));
      if (video.videoWidth === 0) {
        setOcrStatus("no-match");
        return;
      }

      ocrCanvas.width = video.videoWidth;
      ocrCanvas.height = video.videoHeight;
      const ctx = ocrCanvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, ocrCanvas.width, ocrCanvas.height);

      const text = await recognizeRegionText(ocrCanvas, ocrCanvas.width, ocrCanvas.height, region.crop);
      const matched = matchCharacterName(text, characters);

      if (characterLockedRef.current) return; // OCR 처리 중 사용자가 이미 수동으로 캐릭터를 골랐으면 덮어쓰지 않음

      if (matched) {
        characterLockedRef.current = true;
        selectedCharacterIdRef.current = matched.id;
        setSelectedCharacterId(matched.id);
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
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      foundLabelsRef.current = new Set();
      characterLockedRef.current = characterNameRegions.length === 0; // 등록된 인식 영역이 없으면 자동 인식 자체를 안 함
      setAutoDetectedCharacterId(null);
      setOcrStatus("idle");
      setFound([]);
      setScanning(true);
      stream.getVideoTracks()[0]?.addEventListener("ended", stopScan);
      intervalRef.current = setInterval(runScanTick, SCAN_INTERVAL_MS);
      if (characterNameRegions.length > 0) void attemptCharacterOcr();
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

  function runScanTick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    for (const t of templates) {
      if (foundLabelsRef.current.has(t.raidLabel)) continue; // 이미 찾은 레이드는 다시 안 봄

      const img = imagesRef.current.get(t.id);
      if (!img || !img.complete || img.naturalWidth === 0) continue;

      try {
        let nameTemplate = nameSampleCacheRef.current.get(t.id);
        if (!nameTemplate) {
          nameTemplate = sampleNameTemplate(img, t.crop);
          nameSampleCacheRef.current.set(t.id, nameTemplate);
        }

        const result = findBestRowMatch(canvas, canvas.width, canvas.height, nameTemplate, t.crop);
        if (!result || result.score < NAME_MATCH_THRESHOLD) continue; // 이번 프레임엔 이 행이 안 보임(스크롤로 화면 밖)

        const deltaYPct = result.yPct - t.crop.yPct;
        const badgeCropNow: CropPct = { ...t.badgeCrop, yPct: t.badgeCrop.yPct + deltaYPct };
        const badgeSample = sampleBadgeRegion(canvas, canvas.width, canvas.height, badgeCropNow);
        const cleared = greenFraction(badgeSample) >= BADGE_GREEN_THRESHOLD;

        if (!cleared) {
          markSeen(t.raidLabel); // 이름은 찾았지만 아직 "참여 가능" 상태 — 스캔이 보고는 있다는 걸 보여줌
          continue;
        }

        foundLabelsRef.current.add(t.raidLabel);
        applyFound(t.raidLabel);
      } catch {
        // 이미지 로딩/캔버스 문제로 한 템플릿이 실패해도 나머지는 계속 시도
        continue;
      }
    }
  }

  /** 이름은 인식됐지만 아직 클리어(참여 완료 배지)는 아닌 상태를 목록에 표시/갱신한다. */
  function markSeen(raidLabel: string) {
    setFound((prev) => {
      if (prev.some((f) => f.raidLabel === raidLabel)) return prev; // 이미 목록에 있으면 그대로 둠 (checking/applied가 덮어씀)
      return [...prev, { raidLabel, status: "seen" }];
    });
  }

  function upsertFound(raidLabel: string, patch: Partial<FoundEntry>) {
    setFound((prev) => {
      if (!prev.some((f) => f.raidLabel === raidLabel)) return [...prev, { raidLabel, status: "checking", ...patch }];
      return prev.map((f) => (f.raidLabel === raidLabel ? { ...f, ...patch } : f));
    });
  }

  async function applyFound(raidLabel: string) {
    upsertFound(raidLabel, { status: "checking" });
    const characterId = selectedCharacterIdRef.current;
    const raidId = raidIdByCharacterAndName.get(characterId)?.get(raidLabel);
    if (!raidId) {
      upsertFound(raidLabel, { status: "not-in-homework" });
      return;
    }
    try {
      await setRaidCheck({ characterId, raidId, gateNumber: 1, checked: true });
      upsertFound(raidLabel, { status: "applied", raidId, characterId, errorMessage: undefined });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : undefined;
      upsertFound(raidLabel, { status: "failed", errorMessage });
    }
  }

  /** 오탐으로 체크됐을 때 되돌리기. 실제 게임 화면의 배지는 그대로 "참여 완료"로 남아있으므로, 되돌린 뒤
   *  같은 스캔 세션 동안은 foundLabelsRef에 그대로 남겨둬서 곧바로 다시 자동 체크되지 않게 한다
   *  (다시 체크하려면 새로 스캔을 시작하거나 대시보드에서 직접 체크하면 됨). */
  async function undoFound(entry: FoundEntry) {
    if (!entry.raidId || !entry.characterId) return;
    try {
      await setRaidCheck({ characterId: entry.characterId, raidId: entry.raidId, gateNumber: 1, checked: false });
      upsertFound(entry.raidLabel, { status: "undone" });
    } catch (err) {
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
            disabled={characters.length === 0 || templates.length === 0}
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
          {scanning ? "스캔 중... 참여 현황 패널을 천천히 스크롤해주세요." : "대기 중"}
        </span>
      </div>

      {templates.length === 0 && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          아직 등록된 &ldquo;레이드 참여현황 이름표&rdquo; 기준 이미지가 없어요. 아래에서 먼저 추가해주세요.
        </p>
      )}
      {characterNameRegions.length === 0 && (
        <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-400">
          캐릭터 이름 인식 영역을 등록해두면 캐릭터를 직접 고르지 않아도 OCR로 자동 인식돼요 (선택 사항).
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <video
        ref={videoRef}
        muted
        playsInline
        className={["w-full rounded-md border border-neutral-200 bg-neutral-900 dark:border-neutral-800", scanning ? "" : "hidden"].join(" ")}
      />
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={ocrCanvasRef} className="hidden" />

      {found.length > 0 && (
        <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">인식된 레이드</h3>
          <ul className="flex flex-col gap-1.5">
            {found.map((f) => (
              <li
                key={f.raidLabel}
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
                <span>{f.raidLabel}</span>
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
