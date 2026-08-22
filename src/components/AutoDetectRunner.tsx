"use client";

import { useEffect, useRef, useState } from "react";
import { setRaidCheck } from "@/app/actions";
import { recognizeRegionText, matchRaidFromText, type CropPct } from "@/lib/ocrMatch";

type CharacterOption = { id: string; name: string; item_level: number | null };
type RaidOption = { id: string; name: string; difficulty: string; sort_order: number };
type CheckKey = { character_id: string; raid_id: string };

const SCAN_INTERVAL_MS = 800; // 군단장 클리어 배너는 몇 초 안에 보상 화면으로 넘어가버려서, 그 짧은 창을 놓치지 않도록 촘촘하게 스캔
// 연속으로 이만큼 같은 레이드가 나와야 실제로 체크함. 예전 픽셀 비교 방식의 오탐 방지용이었는데, 지금 OCR은
// 레이드 이름+난이도 문자열이 둘 다 정확히 일치해야만 매칭되므로 이미 충분히 엄격해서 1번이면 충분함
// (2번을 요구하면 짧게 스쳐 지나가는 배너를 아예 놓치는 문제가 있었음).
const CONFIRM_SCANS = 1;
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
  resultScreenOcrRegion,
  raids,
  initialChecks,
}: {
  characters: CharacterOption[];
  resultScreenOcrRegion: CropPct | null;
  raids: RaidOption[];
  initialChecks: CheckKey[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ocrBusyRef = useRef(false);
  const lastTriggeredRef = useRef<Map<string, number>>(new Map()); // key -> timestamp
  const pendingMatchRef = useRef<{ raidId: string; count: number } | null>(null);

  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id ?? "");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("대기 중");
  const [lastOcrText, setLastOcrText] = useState("");
  const [checkedSet, setCheckedSet] = useState<Set<string>>(
    () => new Set(initialChecks.map((c) => `${c.character_id}:${c.raid_id}`))
  );
  const checkedSetRef = useRef(checkedSet);
  useEffect(() => {
    checkedSetRef.current = checkedSet;
  }, [checkedSet]);
  const [events, setEvents] = useState<AutoCheckEvent[]>([]);

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
      pendingMatchRef.current = null;
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

  async function runScan() {
    const video = videoRef.current;
    const canvas = frameCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || !resultScreenOcrRegion || ocrBusyRef.current) return;

    ocrBusyRef.current = true;
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const text = await recognizeRegionText(canvas, canvas.width, canvas.height, resultScreenOcrRegion);
      setLastOcrText(text);

      const matched = matchRaidFromText(text, raids);

      if (!matched) {
        pendingMatchRef.current = null;
        return;
      }

      const pending = pendingMatchRef.current;
      pendingMatchRef.current =
        pending && pending.raidId === matched.id ? { raidId: pending.raidId, count: pending.count + 1 } : { raidId: matched.id, count: 1 };

      if (pendingMatchRef.current.count < CONFIRM_SCANS) return;

      const raidLabel = `${matched.name} ${matched.difficulty}`;
      const key = `${selectedCharacterId}:${matched.id}`;
      const lastTriggered = lastTriggeredRef.current.get(key) ?? 0;
      const alreadyChecked = checkedSetRef.current.has(key);
      const cooledDown = Date.now() - lastTriggered > RECHECK_COOLDOWN_MS;

      if (!alreadyChecked && cooledDown) {
        lastTriggeredRef.current.set(key, Date.now());
        setStatusText(`${raidLabel} 감지됨 → 자동 체크 중...`);
        triggerAutoCheck(matched.id, raidLabel);
      }
    } catch {
      setStatusText("텍스트 인식 중 오류가 발생했어요.");
    } finally {
      ocrBusyRef.current = false;
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
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedCharacterId}
          onChange={(e) => setSelectedCharacterId(e.target.value)}
          disabled={sharing}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
            disabled={characters.length === 0 || !resultScreenOcrRegion}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            자동 감지 시작
          </button>
        ) : (
          <button
            type="button"
            onClick={stopShare}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            중지
          </button>
        )}

        <span className="text-sm text-neutral-500 dark:text-neutral-400">{statusText}</span>
      </div>

      {!resultScreenOcrRegion && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          아직 &ldquo;레이드 결과화면 텍스트 인식 영역&rdquo;이 등록되지 않았어요. 아래에서 먼저 추가해주세요.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <video
        ref={videoRef}
        muted
        playsInline
        className={["w-full rounded-md border border-neutral-200 bg-neutral-900 dark:border-neutral-800", sharing ? "" : "hidden"].join(" ")}
      />
      <canvas ref={frameCanvasRef} className="hidden" />

      {lastOcrText && sharing && (
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-400">최근 인식된 텍스트: {lastOcrText}</p>
      )}

      {events.length > 0 && (
        <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">자동 체크 기록</h3>
          <ul className="flex flex-col gap-1.5">
            {events.map((e) => (
              <li
                key={e.id}
                className={[
                  "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs",
                  e.undone
                    ? "border-neutral-200 bg-neutral-50 text-neutral-400 line-through dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400",
                ].join(" ")}
              >
                <span>
                  {e.raidLabel} · {new Date(e.at).toLocaleTimeString()}
                </span>
                {!e.undone && (
                  <button type="button" onClick={() => undoEvent(e)} className="text-red-500 hover:underline dark:text-red-400">
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
