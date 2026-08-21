"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setRaidCheck } from "@/app/actions";
import { sampleFrameCrop, sampleTemplateImage, similarity, type CropPct } from "@/lib/templateMatch";

type CharacterOption = { id: string; name: string; item_level: number | null };
type RaidOption = { id: string; name: string; difficulty: string; sort_order: number };
type ResultTemplate = { id: string; raid_id: string | null; crop: CropPct | null; url: string | null };
type CheckKey = { character_id: string; raid_id: string };

const MATCH_THRESHOLD = 0.82;
const SCAN_INTERVAL_MS = 1200;
const RECHECK_COOLDOWN_MS = 30_000; // 같은 (캐릭터,레이드)를 짧은 시간 안에 반복 감지해도 다시 안 쏘게

type AutoCheckEvent = {
  id: string;
  characterId: string;
  raidId: string;
  raidLabel: string;
  at: number;
  undone: boolean;
};

export default function AutoDetectRunner({
  characters,
  resultScreenTemplates,
  raids,
  initialChecks,
}: {
  characters: CharacterOption[];
  resultScreenTemplates: ResultTemplate[];
  raids: RaidOption[];
  initialChecks: CheckKey[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTriggeredRef = useRef<Map<string, number>>(new Map()); // key -> timestamp

  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id ?? "");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("대기 중");
  const [lastMatchDebug, setLastMatchDebug] = useState<{ label: string; score: number } | null>(null);
  const [checkedSet, setCheckedSet] = useState<Set<string>>(
    () => new Set(initialChecks.map((c) => `${c.character_id}:${c.raid_id}`))
  );
  const checkedSetRef = useRef(checkedSet);
  useEffect(() => {
    checkedSetRef.current = checkedSet;
  }, [checkedSet]);
  const [events, setEvents] = useState<AutoCheckEvent[]>([]);

  const raidsById = useMemo(() => new Map(raids.map((r) => [r.id, r])), [raids]);
  const usableTemplates = useMemo(
    () => resultScreenTemplates.filter((t): t is ResultTemplate & { url: string; crop: CropPct } => !!t.url && !!t.crop && !!t.raid_id),
    [resultScreenTemplates]
  );

  // 템플릿 이미지를 미리 로드해둔다.
  useEffect(() => {
    for (const t of usableTemplates) {
      if (imagesRef.current.has(t.id)) continue;
      const img = new Image();
      img.src = t.url;
      imagesRef.current.set(t.id, img);
    }
  }, [usableTemplates]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startShare() {
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
      setSharing(true);
      setStatusText("감지 중...");
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare);
      intervalRef.current = setInterval(runScan, SCAN_INTERVAL_MS);
    } catch {
      setError("화면공유를 시작하지 못했어요 (권한을 거부했거나 취소했을 수 있어요).");
    }
  }

  function stopShare() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
    setStatusText("대기 중");
  }

  function runScan() {
    const video = videoRef.current;
    const canvas = frameCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let best: { raidId: string; score: number; label: string } | null = null;

    for (const t of usableTemplates) {
      const img = imagesRef.current.get(t.id);
      if (!img || !img.complete || img.naturalWidth === 0) continue;

      const frameSample = sampleFrameCrop(canvas, canvas.width, canvas.height, t.crop);
      const templateSample = sampleTemplateImage(img, t.crop);
      const score = similarity(frameSample, templateSample);

      if (!best || score > best.score) {
        const raid = raidsById.get(t.raid_id!);
        best = { raidId: t.raid_id!, score, label: raid ? `${raid.name} ${raid.difficulty}` : "알 수 없음" };
      }
    }

    if (best) setLastMatchDebug({ label: best.label, score: best.score });

    if (best && best.score >= MATCH_THRESHOLD) {
      const key = `${selectedCharacterId}:${best.raidId}`;
      const lastTriggered = lastTriggeredRef.current.get(key) ?? 0;
      const alreadyChecked = checkedSetRef.current.has(key);
      const cooledDown = Date.now() - lastTriggered > RECHECK_COOLDOWN_MS;

      if (!alreadyChecked && cooledDown) {
        lastTriggeredRef.current.set(key, Date.now());
        setStatusText(`${best.label} 감지됨 → 자동 체크 중...`);
        triggerAutoCheck(best.raidId, best.label);
      }
    }
  }

  async function triggerAutoCheck(raidId: string, raidLabel: string) {
    const key = `${selectedCharacterId}:${raidId}`;
    try {
      await setRaidCheck({ characterId: selectedCharacterId, raidId, gateNumber: 1, checked: true });
      setCheckedSet((prev) => new Set(prev).add(key));
      setEvents((prev) => [
        { id: `${Date.now()}`, characterId: selectedCharacterId, raidId, raidLabel, at: Date.now(), undone: false },
        ...prev,
      ]);
      setStatusText(`${raidLabel} 자동 체크 완료`);
    } catch {
      setStatusText(`${raidLabel} 자동 체크 실패`);
    }
  }

  async function undoEvent(event: AutoCheckEvent) {
    const key = `${event.characterId}:${event.raidId}`;
    try {
      await setRaidCheck({ characterId: event.characterId, raidId: event.raidId, gateNumber: 1, checked: false });
      setCheckedSet((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, undone: true } : e)));
    } catch {
      setError("취소 중 오류가 발생했어요.");
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedCharacterId}
          onChange={(e) => setSelectedCharacterId(e.target.value)}
          disabled={sharing}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 disabled:opacity-50"
        >
          {characters.length === 0 && <option value="">캐릭터 없음</option>}
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {!sharing ? (
          <button
            type="button"
            onClick={startShare}
            disabled={characters.length === 0 || usableTemplates.length === 0}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            자동 감지 시작
          </button>
        ) : (
          <button
            type="button"
            onClick={stopShare}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
          >
            중지
          </button>
        )}

        <span className="text-sm text-neutral-500">{statusText}</span>
      </div>

      {usableTemplates.length === 0 && (
        <p className="mb-2 text-xs text-amber-600">
          아직 사용 가능한 &ldquo;레이드 결과화면&rdquo; 템플릿이 없어요. 아래에서 먼저 추가해주세요.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <video
        ref={videoRef}
        muted
        playsInline
        className={["w-full rounded-md border border-neutral-200 bg-neutral-900", sharing ? "" : "hidden"].join(" ")}
      />
      <canvas ref={frameCanvasRef} className="hidden" />

      {lastMatchDebug && sharing && (
        <p className="mt-2 text-xs text-neutral-400">
          최근 비교: {lastMatchDebug.label} (유사도 {Math.round(lastMatchDebug.score * 100)}%, 기준{" "}
          {Math.round(MATCH_THRESHOLD * 100)}%)
        </p>
      )}

      {events.length > 0 && (
        <div className="mt-4 border-t border-neutral-100 pt-3">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500">자동 체크 기록</h3>
          <ul className="flex flex-col gap-1.5">
            {events.map((e) => (
              <li
                key={e.id}
                className={[
                  "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs",
                  e.undone ? "border-neutral-200 bg-neutral-50 text-neutral-400 line-through" : "border-emerald-200 bg-emerald-50 text-emerald-700",
                ].join(" ")}
              >
                <span>
                  {e.raidLabel} · {new Date(e.at).toLocaleTimeString()}
                </span>
                {!e.undone && (
                  <button type="button" onClick={() => undoEvent(e)} className="text-red-500 hover:underline">
                    취소
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
