// 로스트아크 주간 콘텐츠는 매주 수요일 06:00(KST)에 초기화된다.
// "지금이 몇 번째 주인가"를 별도 배치/크론 없이 계산하기 위해,
// 현재 시각이 속한 초기화 구간의 "시작 수요일 날짜"를 주차 키로 사용한다.
// 예: 8/19(수) 06:00 ~ 8/26(수) 05:59:59 KST 사이는 전부 "2026-08-19".
// → DB에 해당 week_key row가 없으면 자동으로 "이번 주 미체크" 상태가 되어 리셋 로직이 필요 없다.

const RESET_HOUR_KST = 6;
const WEDNESDAY = 3; // Date#getUTCDay(): Sun=0 ... Wed=3

function getKstWallClockParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24; // "24"를 "0"으로 정규화
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** 주어진 시각이 속한 초기화 구간의 시작 수요일을 'YYYY-MM-DD' 형태로 반환한다. */
export function getCurrentWeekKey(date: Date = new Date()): string {
  const { year, month, day, hour, minute, second } = getKstWallClockParts(date);

  // KST는 DST가 없어 오프셋이 항상 +9로 고정이므로, KST 벽시계 값을 그대로 UTC로 취급해도
  // "요일/날짜 연산"에는 문제가 없다 (실제 UTC 절대시각과는 다르지만 계산용 로컬 트릭).
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const shiftedMs = asUtcMs - RESET_HOUR_KST * 60 * 60 * 1000;
  const shifted = new Date(shiftedMs);

  const dow = shifted.getUTCDay();
  const diffToWednesday = (dow - WEDNESDAY + 7) % 7;

  const weekStart = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - diffToWednesday)
  );

  const yy = weekStart.getUTCFullYear();
  const mm = String(weekStart.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(weekStart.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** 다음 초기화까지 남은 시간을 사람이 읽기 좋은 문자열로 반환한다. */
export function getTimeUntilReset(date: Date = new Date()): string {
  const { year, month, day, hour, minute, second } = getKstWallClockParts(date);
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const shiftedMs = asUtcMs - RESET_HOUR_KST * 60 * 60 * 1000;
  const shifted = new Date(shiftedMs);
  const dow = shifted.getUTCDay();
  const diffToNextWednesday = (WEDNESDAY - dow + 7) % 7 || 7;

  const nextResetShifted = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + diffToNextWednesday)
  );
  const nextResetMs = nextResetShifted.getTime() + RESET_HOUR_KST * 60 * 60 * 1000;

  const remainingMs = Math.max(0, nextResetMs - asUtcMs);
  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days}일 ${hours}시간 ${minutes}분`;
}
