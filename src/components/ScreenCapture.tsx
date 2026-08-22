"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveRaidClearTemplate, deleteRaidClearTemplate, type TemplateType } from "@/app/actions";

type RaidOption = { id: string; name: string; difficulty: string; sort_order: number };
type CharacterOption = { id: string; name: string };
type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };
type TemplateRow = {
  id: string;
  raid_id: string | null;
  template_type: string;
  crop: CropPct | null;
  raid_label: string | null;
  badge_crop: CropPct | null;
  character_id: string | null;
  storage_path: string;
  created_at: string;
  url: string | null;
};

const TEMPLATE_TYPE_LABEL: Record<TemplateType, string> = {
  clear_banner: "던전 클리어 배너",
  result_screen: "레이드 결과화면(레이드명)",
  gate_checkmark: "관문 체크마크",
  status_row: "레이드 참여현황 이름표(스크롤 목록)",
  character_name: "캐릭터 이름 인식 영역(OCR, 메뉴 화면 고정 위치)",
};

// 게임 내 "레이드 참여 현황" 패널의 표기가 앱의 레이드 이름과 달라서, 고를 때 헷갈리지 않도록 힌트로 보여준다.
const GAME_PANEL_ALIASES: Record<string, string> = {
  벨가르딘: "페투스 안 크라그마",
  세르카: "코르부스 툴 라크",
  성당: "지평의 성당",
  종막: "종막 : 카제로스",
  "4막": "4막 : 아르모체",
};

type Rect = { x: number; y: number; w: number; h: number };

const DEFAULT_ALLOWED_TYPES: TemplateType[] = ["clear_banner", "result_screen", "gate_checkmark"];

export default function ScreenCapture({
  raids,
  characters = [],
  initialTemplates,
  allowedTypes = DEFAULT_ALLOWED_TYPES,
}: {
  raids: RaidOption[];
  /** 저장된 기준 이미지 목록에서 예전 방식(캐릭터별) character_name 템플릿의 캐릭터명을 표시하는 데만 쓰인다. */
  characters?: CharacterOption[];
  initialTemplates: TemplateRow[];
  /** 이 화면에서 고를 수 있는 기준 이미지 유형을 제한한다 (탭마다 다른 용도로 쓰기 위함). */
  allowedTypes?: TemplateType[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frozenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [sharing, setSharing] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  // status_row 타입 전용: 이름표 영역을 먼저 선택하고, 그다음 배지 영역을 선택하는 2단계 캡처.
  const [captureStage, setCaptureStage] = useState<"name" | "badge">("name");
  const [savedNameSelection, setSavedNameSelection] = useState<Rect | null>(null);

  const distinctRaidNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const r of raids) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        names.push(r.name);
      }
    }
    return names;
  }, [raids]);
  const [selectedRaidLabel, setSelectedRaidLabel] = useState(distinctRaidNames[0] ?? "");

  const [templateType, setTemplateType] = useState<TemplateType>(allowedTypes[0] ?? "clear_banner");
  const [selectedRaidId, setSelectedRaidId] = useState(raids[0]?.id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState(initialTemplates);

  const raidsById = useMemo(() => new Map(raids.map((r) => [r.id, r])), [raids]);
  const charactersById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);

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
    setFrozen(false);
    setSelection(null);
    setSavedNameSelection(null);
    setCaptureStage("name");
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = frozenCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setFrozen(true);
    setSelection(null);
    setSavedNameSelection(null);
    setCaptureStage("name");
  }

  function retake() {
    setFrozen(false);
    setSelection(null);
    setSavedNameSelection(null);
    setCaptureStage("name");
  }

  /** status_row 전용: 이름표 영역 선택을 확정하고 배지 영역 선택 단계로 넘어간다. */
  function confirmNameBox() {
    if (!selection || selection.w < 4 || selection.h < 4) {
      setError("먼저 레이드 이름 부분을 드래그로 선택해주세요.");
      return;
    }
    setError("");
    setSavedNameSelection(selection);
    setSelection(null);
    setCaptureStage("badge");
  }

  function canvasPointFromEvent(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = frozenCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
    };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!frozen) return;
    const p = canvasPointFromEvent(e);
    setDragStart(p);
    setSelection({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragStart) return;
    const p = canvasPointFromEvent(e);
    setSelection({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  }

  function handleMouseUp() {
    setDragStart(null);
  }

  async function saveSelection() {
    const canvas = frozenCanvasRef.current;
    if (!canvas) return;

    if (templateType === "status_row") {
      if (!savedNameSelection) {
        setError("먼저 레이드 이름 부분을 선택해주세요.");
        return;
      }
      if (!selection || selection.w < 4 || selection.h < 4) {
        setError("이제 '참여 완료' 배지 부분을 드래그로 선택해주세요.");
        return;
      }
      if (!selectedRaidLabel) {
        setError("어떤 레이드의 이름표인지 선택해주세요.");
        return;
      }

      setSaving(true);
      setError("");
      try {
        const nameSel = savedNameSelection;
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = nameSel.w;
        cropCanvas.height = nameSel.h;
        const ctx = cropCanvas.getContext("2d");
        if (!ctx) throw new Error("캡처에 실패했어요.");
        ctx.drawImage(canvas, nameSel.x, nameSel.y, nameSel.w, nameSel.h, 0, 0, nameSel.w, nameSel.h);

        const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("이미지 캡처에 실패했어요.");

        const crop: CropPct = {
          xPct: nameSel.x / canvas.width,
          yPct: nameSel.y / canvas.height,
          wPct: nameSel.w / canvas.width,
          hPct: nameSel.h / canvas.height,
        };
        const badgeCrop: CropPct = {
          xPct: selection.x / canvas.width,
          yPct: selection.y / canvas.height,
          wPct: selection.w / canvas.width,
          hPct: selection.h / canvas.height,
        };

        const supabase = createClient();
        // 경로에 한글(레이드 이름)을 넣으면 Supabase Storage 키 검증에서 거부돼서(Invalid key),
        // 파일 경로는 ASCII만 쓰고 실제 레이드 이름은 DB의 raid_label 컬럼에만 저장한다.
        const path = `status_row/shared/${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage
          .from("raid-clear-templates")
          .upload(path, blob, { contentType: "image/png" });
        if (uploadError) throw uploadError;

        await saveRaidClearTemplate({
          raidId: null,
          templateType,
          crop,
          storagePath: path,
          raidLabel: selectedRaidLabel,
          badgeCrop,
        });

        setTemplates((prev) => [
          {
            id: `temp-${Date.now()}`,
            raid_id: null,
            template_type: templateType,
            crop,
            raid_label: selectedRaidLabel,
            badge_crop: badgeCrop,
            character_id: null,
            storage_path: path,
            created_at: new Date().toISOString(),
            url: URL.createObjectURL(blob),
          },
          ...prev,
        ]);

        setFrozen(false);
        setSelection(null);
        setSavedNameSelection(null);
        setCaptureStage("name");
      } catch (err) {
        setError(err instanceof Error ? err.message : "저장 중 오류가 발생했어요.");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!selection || selection.w < 4 || selection.h < 4) {
      setError("저장할 영역을 드래그로 먼저 선택해주세요.");
      return;
    }
    if (templateType === "result_screen" && !selectedRaidId) {
      setError("레이드 결과화면 유형은 어떤 레이드인지 선택해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = selection.w;
      cropCanvas.height = selection.h;
      const ctx = cropCanvas.getContext("2d");
      if (!ctx) throw new Error("캡처에 실패했어요.");
      ctx.drawImage(canvas, selection.x, selection.y, selection.w, selection.h, 0, 0, selection.w, selection.h);

      const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("이미지 캡처에 실패했어요.");

      const crop: CropPct = {
        xPct: selection.x / canvas.width,
        yPct: selection.y / canvas.height,
        wPct: selection.w / canvas.width,
        hPct: selection.h / canvas.height,
      };
      const raidId = templateType === "result_screen" ? selectedRaidId : null;
      const characterId: string | null = null; // OCR 방식으로 바뀌면서 캐릭터별로 등록할 필요가 없어짐

      const supabase = createClient();
      const path = `${templateType}/${raidId ?? "shared"}/${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("raid-clear-templates")
        .upload(path, blob, { contentType: "image/png" });
      if (uploadError) throw uploadError;

      await saveRaidClearTemplate({ raidId, templateType, crop, storagePath: path, characterId });

      setTemplates((prev) => [
        {
          id: `temp-${Date.now()}`,
          raid_id: raidId,
          template_type: templateType,
          crop,
          raid_label: null,
          badge_crop: null,
          character_id: characterId,
          storage_path: path,
          created_at: new Date().toISOString(),
          url: URL.createObjectURL(blob),
        },
        ...prev,
      ]);

      setFrozen(false);
      setSelection(null);
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
      <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {!sharing ? (
            <button
              type="button"
              onClick={startShare}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              화면 공유 시작
            </button>
          ) : (
            <button
              type="button"
              onClick={stopShare}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
            >
              화면 공유 중지
            </button>
          )}

          {sharing && !frozen && (
            <button
              type="button"
              onClick={captureFrame}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              지금 프레임 캡처
            </button>
          )}
        </div>

        {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <video
          ref={videoRef}
          muted
          playsInline
          className={[
            "w-full rounded-md border border-neutral-200 bg-neutral-900 dark:border-neutral-800",
            sharing && !frozen ? "" : "hidden",
          ].join(" ")}
        />
        {!sharing && (
          <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-400">
            화면 공유를 시작하면 여기에 미리보기가 나와요. 로스트아크 창을 선택해주세요.
          </p>
        )}

        {/* frozen이 true가 되기 전에 captureFrame()이 이 캔버스에 그려야 하므로, frozen 여부와 상관없이 항상 마운트해둔다
            (예전엔 {frozen && ...} 안에 있어서 캡처 버튼을 눌러도 캔버스가 아직 없어 아무 일도 안 일어났음). */}
        <div
          className={[
            "relative w-full overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800",
            frozen ? "" : "hidden",
          ].join(" ")}
        >
          <canvas
            ref={frozenCanvasRef}
            className="w-full cursor-crosshair"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
          {templateType === "status_row" && savedNameSelection && frozenCanvasRef.current && (
            <div
              className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/20"
              style={{
                left: `${(savedNameSelection.x / frozenCanvasRef.current.width) * 100}%`,
                top: `${(savedNameSelection.y / frozenCanvasRef.current.height) * 100}%`,
                width: `${(savedNameSelection.w / frozenCanvasRef.current.width) * 100}%`,
                height: `${(savedNameSelection.h / frozenCanvasRef.current.height) * 100}%`,
              }}
            />
          )}
          {selection && frozenCanvasRef.current && (
            <div
              className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/20"
              style={{
                left: `${(selection.x / frozenCanvasRef.current.width) * 100}%`,
                top: `${(selection.y / frozenCanvasRef.current.height) * 100}%`,
                width: `${(selection.w / frozenCanvasRef.current.width) * 100}%`,
                height: `${(selection.h / frozenCanvasRef.current.height) * 100}%`,
              }}
            />
          )}
        </div>

        {frozen && (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {templateType === "status_row"
                ? captureStage === "name"
                  ? "① 먼저 레이드 이름 텍스트 부분만 드래그로 선택하세요 (예: '페투스 안 크라그마')."
                  : "② 이제 그 옆에 있는 '참여 완료' 배지(초록 체크) 부분을 드래그로 선택하세요."
                : templateType === "character_name"
                  ? "게임 메뉴 화면 좌측 하단의 캐릭터 이름(레벨 포함해도 무방) 부분만 드래그로 선택하세요. 한 번만 등록하면 어떤 캐릭터든 OCR로 자동 인식돼요."
                  : "필요한 부분만 마우스로 드래그해서 선택한 뒤 저장하세요 (배너 문구, 레이드명 텍스트, 체크마크 아이콘 등 최소한만 딱 자르는 게 좋아요)."}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={templateType}
                onChange={(e) => {
                  setTemplateType(e.target.value as TemplateType);
                  setSelection(null);
                  setSavedNameSelection(null);
                  setCaptureStage("name");
                }}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {allowedTypes.map((t) => (
                  <option key={t} value={t}>
                    {TEMPLATE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>

              {templateType === "result_screen" && (
                <select
                  value={selectedRaidId}
                  onChange={(e) => setSelectedRaidId(e.target.value)}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  {raids.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.difficulty}
                    </option>
                  ))}
                </select>
              )}

              {templateType === "status_row" && (
                <select
                  value={selectedRaidLabel}
                  onChange={(e) => setSelectedRaidLabel(e.target.value)}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  {distinctRaidNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                      {GAME_PANEL_ALIASES[name] ? ` (게임 내: ${GAME_PANEL_ALIASES[name]})` : ""}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={retake}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
              >
                다시 캡처
              </button>

              {templateType === "status_row" && captureStage === "name" ? (
                <button
                  type="button"
                  onClick={confirmNameBox}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white"
                >
                  다음: 배지 위치 선택
                </button>
              ) : (
                <button
                  type="button"
                  onClick={saveSelection}
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {saving ? "저장 중..." : "선택 영역 저장"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">저장된 기준 이미지 ({templates.length}장)</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-400">아직 저장된 기준 이미지가 없어요.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {templates.map((t) => {
              const raid = t.raid_id ? raidsById.get(t.raid_id) : null;
              const character = t.character_id ? charactersById.get(t.character_id) : null;
              const typeLabel = TEMPLATE_TYPE_LABEL[t.template_type as TemplateType] ?? t.template_type;
              return (
                <div key={t.id} className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                  {t.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.url}
                      alt={typeLabel}
                      className="aspect-video w-full bg-neutral-100 object-contain dark:bg-neutral-800"
                    />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-neutral-100 text-xs text-neutral-400 dark:bg-neutral-800 dark:text-neutral-400">
                      미리보기 없음
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-700 dark:text-neutral-300">{typeLabel}</span>
                      <button type="button" onClick={() => handleDelete(t)} className="text-red-500 hover:underline dark:text-red-400">
                        삭제
                      </button>
                    </div>
                    {raid && <span className="text-neutral-400 dark:text-neutral-400">{raid.name} {raid.difficulty}</span>}
                    {t.raid_label && <span className="text-neutral-400 dark:text-neutral-400">{t.raid_label}</span>}
                    {character && <span className="text-neutral-400 dark:text-neutral-400">{character.name}</span>}
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
