"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveRaidClearTemplate, deleteRaidClearTemplate } from "@/app/actions";

type RaidOption = { id: string; name: string; difficulty: string; sort_order: number };
type TemplateRow = { id: string; raid_id: string; storage_path: string; created_at: string; url: string | null };

export default function ScreenCapture({
  raids,
  initialTemplates,
}: {
  raids: RaidOption[];
  initialTemplates: TemplateRow[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [sharing, setSharing] = useState(false);
  const [selectedRaidId, setSelectedRaidId] = useState(raids[0]?.id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState(initialTemplates);

  const raidsById = useMemo(() => new Map(raids.map((r) => [r.id, r])), [raids]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startShare() {
    setError("");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("이 브라우저는 화면공유(getDisplayMedia)를 지원하지 않아요. 최신 Chrome/Edge를 사용해주세요.");
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
      // 사용자가 브라우저 자체 "공유 중지" 버튼을 눌렀을 때도 상태를 맞춰준다.
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare);
    } catch {
      setError("화면공유를 시작하지 못했어요 (권한을 거부했거나 취소했을 수 있어요).");
    }
  }

  function stopShare() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
  }

  async function captureAndSave() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !selectedRaidId) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setSaving(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("이미지 캡처에 실패했어요.");

      const supabase = createClient();
      const path = `${selectedRaidId}/${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("raid-clear-templates")
        .upload(path, blob, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      await saveRaidClearTemplate(selectedRaidId, path);

      setTemplates((prev) => [
        {
          id: `temp-${Date.now()}`,
          raid_id: selectedRaidId,
          storage_path: path,
          created_at: new Date().toISOString(),
          url: URL.createObjectURL(blob),
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 중 오류가 발생했어요.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(template: TemplateRow) {
    setTemplates((prev) => prev.filter((t) => t.id !== template.id));
    try {
      await deleteRaidClearTemplate(template.id, template.storage_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 중 오류가 발생했어요.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {!sharing ? (
            <button
              type="button"
              onClick={startShare}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              화면 공유 시작
            </button>
          ) : (
            <button
              type="button"
              onClick={stopShare}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
            >
              화면 공유 중지
            </button>
          )}

          <select
            value={selectedRaidId}
            onChange={(e) => setSelectedRaidId(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900"
          >
            {raids.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.difficulty}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={captureAndSave}
            disabled={!sharing || saving || !selectedRaidId}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "저장 중..." : "지금 화면을 기준 이미지로 저장"}
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <video
          ref={videoRef}
          muted
          playsInline
          className={["w-full rounded-md border border-neutral-200 bg-neutral-900", sharing ? "" : "hidden"].join(
            " "
          )}
        />
        {!sharing && (
          <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
            화면 공유를 시작하면 여기에 미리보기가 나와요. 로스트아크 창을 선택해주세요.
          </p>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">저장된 기준 이미지 ({templates.length}장)</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-neutral-400">아직 저장된 기준 이미지가 없어요.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {templates.map((t) => {
              const raid = raidsById.get(t.raid_id);
              return (
                <div key={t.id} className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                  {t.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.url} alt={raid ? `${raid.name} ${raid.difficulty}` : "레이드 클리어 화면"} className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-neutral-100 text-xs text-neutral-400">
                      미리보기 없음
                    </div>
                  )}
                  <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                    <span className="text-neutral-600">{raid ? `${raid.name} ${raid.difficulty}` : "알 수 없음"}</span>
                    <button type="button" onClick={() => handleDelete(t)} className="text-red-500 hover:underline">
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
