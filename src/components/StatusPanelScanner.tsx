"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setRaidCheck } from "@/app/actions";
import { findBestRowMatch, sampleBadgeRegion, sampleNameTemplate, greenFraction, type CropPct } from "@/lib/rowScan";

type CharacterOption = { id: string; name: string; item_level: number | null };
type RaidOption = { id: string; name: string; difficulty: string };
type CharacterRaidRow = { character_id: string; raid_id: string };
type StatusRowTemplate = { id: string; raidLabel: string; crop: CropPct; badgeCrop: CropPct; url: string };

// 결과화면 매칭(88%)보다는 관대하게 — 이름표 텍스트 자체가 작고, 목록 스크롤 중이라 프레임이 살짝
// 흔들릴 수 있어서 너무 빡빡하면 아예 못 찾을 수 있음. 실사용하며 조정 필요할 수 있음.
const NAME_MATCH_THRESHOLD = 0.85;
const BADGE_GREEN_THRESHOLD = 0.12;
const SCAN_INTERVAL_MS = 900;

type FoundStatus = "checking" | "applied" | "not-in-homework" | "failed";
type FoundEntry = { raidLabel: string; status: FoundStatus };

const STATUS_LABEL: Record<FoundStatus, string> = {
  checking: "확인 중...",
  applied: "체크 완료",
  "not-in-homework": "이 캐릭터 숙제에 없음",
  failed: "체크 실패",
};

export default function StatusPanelScanner({
  characters,
  raids,
  characterRaids,
  templates,
}: {
  characters: CharacterOption[];
  raids: RaidOption[];
  characterRaids: CharacterRaidRow[];
  templates: StatusRowTemplate[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const nameSampleCacheRef = useRef<Map<string, ImageData>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const foundLabelsRef = useRef<Set<string>>(new Set());
  const selectedCharacterIdRef = useRef("");

  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id ?? "");
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
      setFound([]);
      setScanning(true);
      stream.getVideoTracks()[0]?.addEventListener("ended", stopScan);
      intervalRef.current = setInterval(runScanTick, SCAN_INTERVAL_MS);
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
        if (!result || result.score < NAME_MATCH_THRESHOLD) continue;

        const deltaYPct = result.yPct - t.crop.yPct;
        const badgeCropNow: CropPct = { ...t.badgeCrop, yPct: t.badgeCrop.yPct + deltaYPct };
        const badgeSample = sampleBadgeRegion(canvas, canvas.width, canvas.height, badgeCropNow);
        if (greenFraction(badgeSample) < BADGE_GREEN_THRESHOLD) continue; // 아직 "참여 가능" 상태

        foundLabelsRef.current.add(t.raidLabel);
        applyFound(t.raidLabel);
      } catch {
        // 이미지 로딩/캔버스 문제로 한 템플릿이 실패해도 나머지는 계속 시도
        continue;
      }
    }
  }

  async function applyFound(raidLabel: string) {
    setFound((prev) => [...prev, { raidLabel, status: "checking" }]);
    const characterId = selectedCharacterIdRef.current;
    const raidId = raidIdByCharacterAndName.get(characterId)?.get(raidLabel);
    if (!raidId) {
      setFound((prev) => prev.map((f) => (f.raidLabel === raidLabel ? { ...f, status: "not-in-homework" } : f)));
      return;
    }
    try {
      await setRaidCheck({ characterId, raidId, gateNumber: 1, checked: true });
      setFound((prev) => prev.map((f) => (f.raidLabel === raidLabel ? { ...f, status: "applied" } : f)));
    } catch {
      setFound((prev) => prev.map((f) => (f.raidLabel === raidLabel ? { ...f, status: "failed" } : f)));
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedCharacterId}
          onChange={(e) => setSelectedCharacterId(e.target.value)}
          disabled={scanning}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          {characters.length === 0 && <option value="">캐릭터 없음</option>}
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

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
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <video
        ref={videoRef}
        muted
        playsInline
        className={["w-full rounded-md border border-neutral-200 bg-neutral-900 dark:border-neutral-800", scanning ? "" : "hidden"].join(" ")}
      />
      <canvas ref={canvasRef} className="hidden" />

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
                    : f.status === "checking"
                      ? "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
                      : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
                ].join(" ")}
              >
                <span>{f.raidLabel}</span>
                <span>{STATUS_LABEL[f.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
