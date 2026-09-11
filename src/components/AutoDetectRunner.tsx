"use client";

import { useEffect, useRef, useState } from "react";
import { setRaidCheck } from "@/app/actions";
import {
  recognizeRegionText,
  matchRaidFromText,
  matchCharacterName,
  matchesClearButtonText,
  SCREEN_CAPTURE_VIDEO_CONSTRAINTS,
  type CropPct,
} from "@/lib/ocrMatch";

type CharacterOption = { id: string; name: string; item_level: number | null };
type RaidOption = { id: string; name: string; difficulty: string; sort_order: number };
type CheckKey = { character_id: string; raid_id: string };

const SCAN_INTERVAL_MS = 800; // 군단장 클리어 배너는 몇 초 안에 보상 화면으로 넘어가버려서, 그 짧은 창을 놓치지 않도록 촘촘하게 스캔
// 연속으로 이만큼 같은 레이드가 나와야 실제로 체크함. 예전 픽셀 비교 방식의 오탐 방지용이었는데, 지금 OCR은
// 레이드 이름+난이도 문자열이 둘 다 정확히 일치해야만 매칭되므로 이미 충분히 엄격해서 1번이면 충분함
// (2번을 요구하면 짧게 스쳐 지나가는 배너를 아예 놓치는 문제가 있었음).
const CONFIRM_SCANS = 1;
// 캐릭터 이름은 연속 이만큼 같은 결과가 나와야 확정한다 — 레이드와 달리 한 번 잡으면 세션 내내 고정이라
// 프레임 하나만 잘못 읽혀도 계속 엉뚱한 캐릭터로 남기 때문. 이름은 화면에 계속 떠 있어서 놓칠 일이 없다.
const CONFIRM_CHARACTER_SCANS = 2;
// 레이드를 자동 체크하고 이만큼 지나면 캐릭터 잠금을 스스로 풀어서 이름을 다시 읽는다. 한 캐릭터로 레이드를
// 돌고 나면 보통 다른 캐릭터로 갈아타는데, 그때마다 "캐릭터 재감지" 버튼을 누르는 게 번거로워서 넣었다.
// 클리어 직후엔 아직 결과/보상 화면이라 파티원 목록이 안 떠 있고, 캐릭터를 바꿔 다음 레이드에 들어가기까지
// 시간이 걸리므로 넉넉하게 3분을 기다린다(그 사이에 손으로 재감지/직접 선택을 하면 예약은 취소됨).
const REDETECT_AFTER_CHECK_MS = 3 * 60 * 1000;

type AutoCheckEvent = {
  id: string;
  characterId: string;
  // 스캔 도중에도 캐릭터가 자동으로 다시 잡힐 수 있어서(재감지), 지금 선택된 캐릭터가 아니라 "체크한
  // 그 시점의 캐릭터 이름"을 기록에 그대로 남긴다.
  characterName: string;
  raidId: string;
  raidLabel: string;
  at: number;
  undone: boolean;
};

type OcrStatus = "idle" | "recognizing" | "matched" | "no-match";

export default function AutoDetectRunner({
  characters,
  resultScreenOcrRegion,
  clearButtonOcrRegion,
  characterNameRegion,
  raids,
  initialChecks,
}: {
  characters: CharacterOption[];
  resultScreenOcrRegion: CropPct | null;
  /** "나가기" 버튼 텍스트만 따로 좁게 등록한 영역 — 없으면 결과화면 영역 텍스트 안에서 "나가기"를 찾는
   *  예전 방식으로 대체한다(하위 호환, 정확도는 따로 등록하는 쪽이 더 높음). */
  clearButtonOcrRegion: CropPct | null;
  /** 레이드 중 화면 우측 파티원 목록 맨 위(항상 내 캐릭터) 이름 인식 영역 — 등록 안 해도 기존처럼 직접 고르면 됨. */
  characterNameRegion: CropPct | null;
  raids: RaidOption[];
  initialChecks: CheckKey[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // setInterval에 등록한 콜백은 startShare()를 호출한 순간의 runScan 클로저를 계속 붙잡고 있어서, 스캔 도중
  // 캐릭터 자동 인식으로 selectedCharacterId가 바뀌어도 반영이 안 되는 문제가 있었다(메뉴 감지에서 이미 한 번
  // 겪은 것과 같은 stale closure 버그). ref에 매 렌더마다 최신 함수를 담아두고, 인터벌은 이 ref로만 호출한다.
  const runScanRef = useRef<() => Promise<void>>(async () => {});
  const ocrBusyRef = useRef(false);
  // 한 번 트리거한 (캐릭터,레이드)는 이 스캔 세션 동안 다시 트리거하지 않는다(시간 기반 쿨다운이었을 때는
  // "나가기" 화면에 30초 넘게 머물면 같은 클리어가 다시 트리거돼서 히스토리에 중복 기록이 남는 문제가 있었음).
  const triggeredKeysRef = useRef<Set<string>>(new Set());
  const pendingMatchRef = useRef<{ raidId: string; count: number } | null>(null);
  // 사용자가 수동으로 캐릭터를 고르거나, 자동 인식이 한 번 성공하면 true — 그 뒤로는 매 틱마다 다시 안 읽는다
  // (메뉴 감지처럼 캐릭터를 자주 바꿔가며 스캔하는 용도가 아니라, 한 캐릭터로 계속 도는 게 보통이라 매번
  // 재인식할 필요가 없음 — "재감지" 버튼을 눌렀을 때만 다시 풀림).
  const characterLockedRef = useRef(false);
  // 캐릭터는 한 번 잡으면 "재감지"를 누르기 전까지 그 세션 내내 고정이라, 프레임 하나만 잘못 읽혀도 계속
  // 엉뚱한 캐릭터로 남는다. 그래서 연속으로 같은 캐릭터가 나왔을 때만 확정한다(스캔 간격이 0.8초라
  // 실제 체감 지연은 1초 미만). 레이드 배너와 달리 파티원 이름은 화면에 계속 떠 있어서 놓칠 걱정이 없다.
  const pendingCharacterRef = useRef<{ id: string; count: number } | null>(null);
  // 자동 체크 뒤 REDETECT_AFTER_CHECK_MS 후에 캐릭터 잠금을 풀어주는 예약 타이머
  const redetectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 재감지(3분 타이머 또는 버튼)로 잠금을 풀었는데 아직 다시 확정되지 않았으면 "풀기 직전 캐릭터 id",
  // 아니면 null. 다시 확정되는 순간 상태 줄의 "캐릭터 재감지 중..."을 "재감지 완료"로 바꾸고, 같은
  // 캐릭터를 다시 잡은 건지 다른 캐릭터로 바뀐 건지 구분해서 보여주는 데 쓴다.
  const redetectFromIdRef = useRef<string | null>(null);
  const selectedCharacterIdRef = useRef(characters[0]?.id ?? "");

  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id ?? "");
  const [autoDetectedCharacterId, setAutoDetectedCharacterId] = useState<string | null>(null);
  const [characterOcrStatus, setCharacterOcrStatus] = useState<OcrStatus>("idle");
  const [redetectArmed, setRedetectArmed] = useState(false);
  const [lastCharacterOcrText, setLastCharacterOcrText] = useState("");
  useEffect(() => {
    selectedCharacterIdRef.current = selectedCharacterId;
  }, [selectedCharacterId]);

  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("대기 중");
  const [lastOcrText, setLastOcrText] = useState("");
  const [lastClearButtonOcrText, setLastClearButtonOcrText] = useState<string | null>(null);
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
      if (redetectTimerRef.current) clearTimeout(redetectTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function selectCharacterManually(characterId: string) {
    cancelScheduledRedetect(); // 직접 고른 건 그대로 유지 — 예약된 자동 재감지가 나중에 덮어쓰지 않게
    if (redetectFromIdRef.current !== null) {
      // 재감지 도중에 직접 골랐으면 재감지는 끝난 것 — "캐릭터 재감지 중..."이 계속 남아있지 않게 한다.
      redetectFromIdRef.current = null;
      const name = characters.find((c) => c.id === characterId)?.name;
      if (name) setStatusText(`직접 선택 · ${name}`);
    }
    selectedCharacterIdRef.current = characterId;
    setSelectedCharacterId(characterId);
    setAutoDetectedCharacterId(null);
    characterLockedRef.current = true; // 수동으로 고르면 자동 인식이 덮어쓰지 않게
  }

  /** 예약해둔 "N분 뒤 캐릭터 재감지"를 취소한다 — 그 사이에 사용자가 직접 재감지/선택했거나 스캔을
   *  중지했으면 예약이 남아있을 이유가 없다. */
  function cancelScheduledRedetect() {
    if (redetectTimerRef.current) {
      clearTimeout(redetectTimerRef.current);
      redetectTimerRef.current = null;
    }
    setRedetectArmed(false);
  }

  /** 레이드 자동 체크 직후 호출 — REDETECT_AFTER_CHECK_MS 뒤에 캐릭터 잠금을 자동으로 풀어준다.
   *  연달아 체크가 일어나면 마지막 체크 시점 기준으로 다시 센다. */
  function scheduleRedetectAfterCheck() {
    if (!characterNameRegion) return; // 이름 인식 영역이 없으면 애초에 자동 인식 자체를 안 하므로 풀 잠금도 없음
    cancelScheduledRedetect();
    setRedetectArmed(true);
    redetectTimerRef.current = setTimeout(() => {
      redetectTimerRef.current = null;
      if (!streamRef.current) { // 그 사이 스캔을 중지했으면 아무것도 안 함
        setRedetectArmed(false);
        return;
      }
      redetectCharacter();
    }, REDETECT_AFTER_CHECK_MS);
  }

  /** "재감지" 버튼 — 캐릭터를 바꿔서 레이드에 가거나 오탐으로 다른 캐릭터가 잡혔을 때, 다시 OCR로
   *  잡도록 잠금을 풀어준다. 스캔 중이면 다음 틱(최대 0.8초 뒤)에 바로 다시 읽는다. */
  function redetectCharacter() {
    cancelScheduledRedetect();
    // 재감지 중에 또 눌렀으면 맨 처음 풀었을 때의 캐릭터를 그대로 비교 기준으로 둔다.
    if (redetectFromIdRef.current === null) redetectFromIdRef.current = selectedCharacterIdRef.current;
    characterLockedRef.current = false;
    pendingCharacterRef.current = null;
    setAutoDetectedCharacterId(null);
    setCharacterOcrStatus("idle");
    setLastCharacterOcrText("");
    setStatusText("캐릭터 재감지 중...");
  }

  /** 파티원 목록 맨 위 캐릭터 이름을 읽어서 selectedCharacterIdRef를 최신으로 맞춘다. runScan()의 맨 앞에서
   *  매번 호출하지만, characterLockedRef가 true면(한 번 성공했거나 수동 선택했으면) 곧바로 리턴하고 아무
   *  것도 안 읽는다 — 메뉴 감지와 달리 자동 감지는 스캔 내내 같은 캐릭터로 도는 게 보통이라 매 틱마다 다시
   *  읽을 필요가 없고, "재감지" 버튼을 누르면 다시 풀려서 다음 틱에 재시도한다. */
  async function verifyCharacter(video: HTMLVideoElement) {
    if (!characterNameRegion || characterLockedRef.current || video.videoWidth === 0) return;

    setCharacterOcrStatus("recognizing");
    try {
      // video를 바로 넘기면 크롭 영역 크기만큼만 그려지므로(recognizeRegionText 내부에서), 4K 프레임
      // 전체를 매 틱마다 캔버스에 복사하는 불필요한 비용을 없앨 수 있다.
      // 파티원 목록 맨 위 이름은 빨간 체력바 위에 흰 글씨로 뜨는 고정된 색 조합이라, 전용 대비 처리(whiteOnRed)를 쓴다.
      const text = await recognizeRegionText(
        video,
        video.videoWidth,
        video.videoHeight,
        characterNameRegion,
        "line",
        "whiteOnRed"
      );
      setLastCharacterOcrText(text);
      const matched = matchCharacterName(text, characters);

      if (characterLockedRef.current) return; // OCR 처리 중 사용자가 수동으로 골랐으면 무시

      if (matched) {
        // 직전 스캔과 같은 캐릭터일 때만 카운트를 올리고, 다른 게 나오면 처음부터 다시 센다.
        const pending = pendingCharacterRef.current;
        pendingCharacterRef.current =
          pending && pending.id === matched.id ? { id: matched.id, count: pending.count + 1 } : { id: matched.id, count: 1 };

        if (pendingCharacterRef.current.count < CONFIRM_CHARACTER_SCANS) return; // 아직 확정 전 — 다음 틱에 한 번 더 확인

        const redetectFromId = redetectFromIdRef.current;
        if (redetectFromId !== null) {
          redetectFromIdRef.current = null;
          // 같은 캐릭터면 "그 캐릭터를 다시 잡은 것", 다르면 "다른 캐릭터로 바꿔 잡은 것"이라 둘을 구분해서 보여준다.
          const prevName = characters.find((c) => c.id === redetectFromId)?.name;
          setStatusText(
            redetectFromId === matched.id
              ? `재감지 완료 · ${matched.name} (같은 캐릭터)`
              : prevName
                ? `재감지 완료 · ${prevName} → ${matched.name}`
                : `재감지 완료 · ${matched.name}`
          );
        }

        if (matched.id !== selectedCharacterIdRef.current) {
          selectedCharacterIdRef.current = matched.id;
          setSelectedCharacterId(matched.id);
        }
        setAutoDetectedCharacterId(matched.id);
        setCharacterOcrStatus("matched");
        characterLockedRef.current = true; // 한 번 잡았으면 "재감지" 누르기 전까진 다시 안 읽음
      } else {
        pendingCharacterRef.current = null;
        setCharacterOcrStatus("no-match");
      }
    } catch {
      setCharacterOcrStatus("no-match");
    }
  }

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
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_CAPTURE_VIDEO_CONSTRAINTS, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      cancelScheduledRedetect(); // 이전 세션에서 남은 예약이 있으면 버린다
      redetectFromIdRef.current = null; // 첫 인식은 "재감지"가 아니므로 완료 문구도 띄우지 않는다
      characterLockedRef.current = false; // 새 스캔을 시작할 때마다 자동 인식에 다시 기회를 준다
      pendingCharacterRef.current = null;
      setAutoDetectedCharacterId(null);
      setCharacterOcrStatus("idle");
      setSharing(true);
      setStatusText("감지 중...");
      pendingMatchRef.current = null;
      triggeredKeysRef.current = new Set();
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare);
      void runScanRef.current();
      intervalRef.current = setInterval(() => void runScanRef.current(), SCAN_INTERVAL_MS);
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
    cancelScheduledRedetect();
    redetectFromIdRef.current = null;
    setSharing(false);
    setStatusText("대기 중");
  }

  async function runScan() {
    const video = videoRef.current;
    const canvas = frameCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || !resultScreenOcrRegion || ocrBusyRef.current) return;

    ocrBusyRef.current = true;
    try {
      await verifyCharacter(video);
      const characterId = selectedCharacterIdRef.current;
      if (!characterId) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const text = await recognizeRegionText(canvas, canvas.width, canvas.height, resultScreenOcrRegion);
      setLastOcrText(text);

      // "나가기" 버튼 전용 영역이 따로 등록돼 있으면 항상 같이 읽어서 보여준다 — 레이드 매칭 성공 여부와
      // 상관없이(추적 안 하는 컨텐츠를 하고 있어도) 지금 이 영역이 뭘로 읽히는지 바로 확인할 수 있게
      // 하기 위함. 매칭에 실패해서 아래에서 바로 return해도 이 디버그 표시는 이미 갱신된 상태.
      let buttonText: string | null = null;
      if (clearButtonOcrRegion) {
        buttonText = await recognizeRegionText(canvas, canvas.width, canvas.height, clearButtonOcrRegion);
        setLastClearButtonOcrText(buttonText);
      } else {
        setLastClearButtonOcrText(null); // 별도 영역이 없으면 결과화면 텍스트 안에서 찾으므로 따로 보여줄 게 없음
      }

      const matched = matchRaidFromText(text, raids);

      if (!matched) {
        pendingMatchRef.current = null;
        return;
      }

      // 레이드명·난이도만으론 입장 직후부터 항상 떠 있어서 클리어 전후 구분이 안 되므로, "나가기" 버튼
      // 텍스트까지 확인돼야 클리어로 인정한다(오탐 방지).
      const cleared = clearButtonOcrRegion ? matchesClearButtonText(buttonText ?? "") : matchesClearButtonText(text);
      if (!cleared) {
        pendingMatchRef.current = null;
        return;
      }

      const pending = pendingMatchRef.current;
      pendingMatchRef.current =
        pending && pending.raidId === matched.id ? { raidId: pending.raidId, count: pending.count + 1 } : { raidId: matched.id, count: 1 };

      if (pendingMatchRef.current.count < CONFIRM_SCANS) return;

      const raidLabel = `${matched.name} ${matched.difficulty}`;
      const key = `${characterId}:${matched.id}`;
      const alreadyChecked = checkedSetRef.current.has(key) || triggeredKeysRef.current.has(key);

      if (!alreadyChecked) {
        triggeredKeysRef.current.add(key); // 이 스캔 세션 동안은 같은 (캐릭터,레이드)를 다시 안 쏨(중복 기록 방지)
        const detectedName = characters.find((c) => c.id === characterId)?.name;
        setStatusText(`${detectedName ? `${detectedName} · ` : ""}${raidLabel} 감지됨 → 자동 체크 중...`);
        triggerAutoCheck(characterId, matched.id, raidLabel);
      }
    } catch {
      setStatusText("텍스트 인식 중 오류가 발생했어요.");
    } finally {
      ocrBusyRef.current = false;
    }
  }

  useEffect(() => {
    runScanRef.current = runScan;
  });

  async function triggerAutoCheck(characterId: string, raidId: string, raidLabel: string) {
    const key = `${characterId}:${raidId}`;
    const characterName = characters.find((c) => c.id === characterId)?.name ?? "알 수 없는 캐릭터";
    try {
      await setRaidCheck({ characterId, raidId, gateNumber: 1, checked: true });
      setCheckedSet((prev) => new Set(prev).add(key));
      setEvents((prev) => [
        { id: `${Date.now()}`, characterId, characterName, raidId, raidLabel, at: Date.now(), undone: false },
        ...prev,
      ]);
      setStatusText(`${characterName} · ${raidLabel} 자동 체크 완료`);
    } catch {
      // 아주 가끔 서버 액션 처리 중 일시적인 오류로 실패하는 경우가 있어서, 잠깐 쉬었다가 한 번 더
      // 시도해본다(메뉴 감지의 applyFound와 동일한 재시도 패턴). 그래도 실패하면 이 세션에선 다시 안 쏜다
      // (triggeredKeysRef에 이미 등록해뒀음 — 필요하면 대시보드에서 직접 체크하면 됨).
      try {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await setRaidCheck({ characterId, raidId, gateNumber: 1, checked: true });
        setCheckedSet((prev) => new Set(prev).add(key));
        setEvents((prev) => [
          { id: `${Date.now()}`, characterId, characterName, raidId, raidLabel, at: Date.now(), undone: false },
          ...prev,
        ]);
        setStatusText(`${characterName} · ${raidLabel} 자동 체크 완료`);
      } catch {
        setStatusText(`${characterName} · ${raidLabel} 자동 체크 실패`);
      }
    }
    // 체크가 성공했든 실패했든 "이 레이드는 끝났다"는 신호는 같으므로, 잠시 뒤 캐릭터를 다시 읽도록 예약한다.
    scheduleRedetectAfterCheck();
  }

  async function undoEvent(event: AutoCheckEvent) {
    const key = `${event.characterId}:${event.raidId}`;
    // 취소 버튼을 눌렀을 때 서버 응답을 기다렸다가 화면을 바꾸면 체감 지연이 커서, 먼저 화면부터 바꾸고
    // 실패하면 되돌린다(대시보드 체크 토글과 동일한 낙관적 업데이트 방식).
    setCheckedSet((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, undone: true } : e)));
    try {
      await setRaidCheck({ characterId: event.characterId, raidId: event.raidId, gateNumber: 1, checked: false });
    } catch (err) {
      setCheckedSet((prev) => new Set(prev).add(key));
      setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, undone: false } : e)));
      setError(err instanceof Error ? err.message : "취소 중 오류가 발생했어요.");
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {/* 버튼들이 항상 같은 위치에 있도록, 폭이 수시로 바뀌는 상태 표시(뱃지/인식 텍스트)는 전부 별도 줄로
          뺐다 — 원래 한 줄에 같이 있을 때는 "자동 인식 실패" 같은 문구가 나타났다 사라졌다 하면서 그 뒤에
          있던 중지 버튼이 좌우로 밀려서 클릭하기 어려운 문제가 있었음. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
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
        {sharing && characterNameRegion && (
          <button
            type="button"
            onClick={redetectCharacter}
            title="캐릭터를 바꿔서 갔거나 오탐으로 다른 캐릭터가 잡혔을 때 다시 인식시켜요. (자동 체크 3분 뒤에는 저절로 다시 인식해요)"
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
          >
            캐릭터 재감지
          </button>
        )}

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
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-500 dark:text-neutral-400">{statusText}</span>
        {autoDetectedCharacterId === selectedCharacterId && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-400">
            OCR로 자동 인식됨
          </span>
        )}
        {sharing && redetectArmed && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            3분 뒤 캐릭터 자동 재감지
          </span>
        )}
        {sharing && characterOcrStatus === "recognizing" && (
          <span className="text-xs text-neutral-400 dark:text-neutral-400">캐릭터 이름 인식 중...</span>
        )}
        {sharing && characterOcrStatus === "no-match" && (
          <span className="text-xs text-neutral-400 dark:text-neutral-400">자동 인식 실패 — 직접 선택해주세요</span>
        )}
      </div>
      {characterNameRegion && lastCharacterOcrText && sharing && (
        <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-400">
          캐릭터 이름 인식 텍스트: {lastCharacterOcrText}
        </p>
      )}

      {!resultScreenOcrRegion && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          아직 &ldquo;레이드 결과화면 텍스트 인식 영역&rdquo;이 등록되지 않았어요. 아래에서 먼저 추가해주세요.
        </p>
      )}
      {!characterNameRegion && (
        <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-400">
          &ldquo;파티원 목록 맨 위 캐릭터 이름 인식 영역&rdquo;을 등록해두면 캐릭터를 직접 고르지 않아도 OCR로
          자동 인식돼요(선택 사항). 등록해두면 스캔 중 캐릭터를 바꿔도 자동으로 따라가요.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className={["relative", sharing ? "" : "hidden"].join(" ")}>
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full rounded-md border border-neutral-200 bg-neutral-900 dark:border-neutral-800"
        />
        {/* 지금 OCR이 실제로 보고 있는 영역이 화면 어디인지 눈으로 바로 확인할 수 있도록 겹쳐 그린다 —
            등록한 크롭이 실제 게임 화면 요소와 안 맞아도 여기서 바로 티가 나서 디버깅하기 쉬워짐. */}
        {resultScreenOcrRegion && (
          <div
            className="pointer-events-none absolute border-2 border-emerald-400"
            style={{
              left: `${resultScreenOcrRegion.xPct * 100}%`,
              top: `${resultScreenOcrRegion.yPct * 100}%`,
              width: `${resultScreenOcrRegion.wPct * 100}%`,
              height: `${resultScreenOcrRegion.hPct * 100}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-emerald-500 px-1 text-[10px] font-medium text-white">
              결과화면 인식 영역
            </span>
          </div>
        )}
        {clearButtonOcrRegion && (
          <div
            className="pointer-events-none absolute border-2 border-amber-400"
            style={{
              left: `${clearButtonOcrRegion.xPct * 100}%`,
              top: `${clearButtonOcrRegion.yPct * 100}%`,
              width: `${clearButtonOcrRegion.wPct * 100}%`,
              height: `${clearButtonOcrRegion.hPct * 100}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-amber-500 px-1 text-[10px] font-medium text-white">
              나가기 버튼 인식 영역
            </span>
          </div>
        )}
        {characterNameRegion && (
          <div
            className="pointer-events-none absolute border-2 border-sky-400"
            style={{
              left: `${characterNameRegion.xPct * 100}%`,
              top: `${characterNameRegion.yPct * 100}%`,
              width: `${characterNameRegion.wPct * 100}%`,
              height: `${characterNameRegion.hPct * 100}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-sky-500 px-1 text-[10px] font-medium text-white">
              캐릭터 이름 인식 영역
            </span>
          </div>
        )}
      </div>
      <canvas ref={frameCanvasRef} className="hidden" />

      {lastOcrText && sharing && (
        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-400">결과화면 인식 텍스트: {lastOcrText}</p>
      )}
      {clearButtonOcrRegion && lastClearButtonOcrText !== null && sharing && (
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-400">
          나가기 버튼 인식 텍스트: {lastClearButtonOcrText || "(빈 텍스트)"}
        </p>
      )}

      {events.length > 0 && (
        <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">자동 체크 기록</h3>
          <ul className="flex flex-col gap-1.5">
            {events.map((e) => (
              <li
                key={e.id}
                className={[
                  // 캐릭터 이름까지 들어가면서 줄이 길어져서, 좁은 화면에선 텍스트가 줄바꿈되더라도
                  // "취소" 버튼은 찌그러지지 않도록 gap과 shrink-0을 준다.
                  "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                  e.undone
                    ? "border-neutral-200 bg-neutral-50 text-neutral-400 line-through dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-400"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400",
                ].join(" ")}
              >
                <span>
                  <span className="font-semibold">{e.characterName}</span> · {e.raidLabel} ·{" "}
                  {new Date(e.at).toLocaleTimeString()}
                </span>
                {!e.undone && (
                  <button
                    type="button"
                    onClick={() => undoEvent(e)}
                    className="shrink-0 text-red-500 hover:underline dark:text-red-400"
                  >
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
