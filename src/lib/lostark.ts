// 로스트아크 공식 오픈 API 클라이언트 (서버에서만 호출; 키를 클라이언트에 노출하지 않는다).
// 문서: https://developer-lostark.game.onstove.com/
//
// 주의: 이 API는 "캐릭터가 이번 주 레이드를 클리어했는지" 는 제공하지 않는다.
// 여기서는 원정대(같은 계정) 캐릭터 목록, 아이템 레벨, 전투력을 자동으로 가져오는 데 사용한다.

const BASE_URL = "https://developer-lostark.game.onstove.com";

export type LostArkSibling = {
  ServerName: string;
  CharacterName: string;
  CharacterLevel: number;
  CharacterClassName: string;
  ItemAvgLevel: string; // 예: "1,700.00"
  ItemMaxLevel: string;
};

export class LostArkApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function getApiKey(): string {
  const key = process.env.LOSTARK_API_KEY;
  if (!key) {
    throw new LostArkApiError(
      "서버에 LOSTARK_API_KEY 환경 변수가 설정되어 있지 않아요.",
      500
    );
  }
  return key;
}

/** 대표 캐릭터명 하나로 같은 원정대(계정)의 전체 캐릭터 목록을 가져온다. */
export async function fetchRoster(characterName: string): Promise<LostArkSibling[]> {
  const res = await fetch(
    `${BASE_URL}/characters/${encodeURIComponent(characterName)}/siblings`,
    {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (res.status === 401) {
    throw new LostArkApiError("API 키가 올바르지 않거나 만료됐어요.", 401);
  }
  if (res.status === 404) {
    throw new LostArkApiError("해당 이름의 캐릭터를 찾을 수 없어요.", 404);
  }
  if (!res.ok) {
    throw new LostArkApiError(`로스트아크 API 호출 실패 (status ${res.status})`, res.status);
  }

  const data = (await res.json()) as LostArkSibling[] | null;
  return data ?? [];
}

export type CombatPowerProfile = { combatPower: number | null; itemLevel: number | null };

/** 캐릭터 하나의 전투력+아이템 레벨을 가져온다("프로필 조회" 응답 하나에 둘 다 들어있어서 API 호출을
 *  따로 안 나눠도 됨). 프로필 조회가 실패해도 전체 목록 조회를 막지 않도록 null로 처리한다. */
export async function fetchCombatPower(characterName: string): Promise<CombatPowerProfile> {
  try {
    const res = await fetch(
      `${BASE_URL}/armories/characters/${encodeURIComponent(characterName)}/profiles`,
      {
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          accept: "application/json",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return { combatPower: null, itemLevel: null };
    const data = (await res.json()) as { CombatPower?: string; ItemAvgLevel?: string } | null;
    return {
      combatPower: data?.CombatPower ? parseFormattedNumber(data.CombatPower) : null,
      itemLevel: data?.ItemAvgLevel ? parseFormattedNumber(data.ItemAvgLevel) : null,
    };
  } catch {
    return { combatPower: null, itemLevel: null };
  }
}

/** 캐릭터의 직업 각인(ArkPassive Title)을 가져온다. 예: "만개", "질풍노도". */
export async function fetchClassEngraving(characterName: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/armories/characters/${encodeURIComponent(characterName)}/arkpassive`,
      {
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          accept: "application/json",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { Title?: string } | null;
    return data?.Title || null;
  } catch {
    return null;
  }
}

/** "1,700.00" 같은 콤마 포함 숫자 문자열을 숫자로 변환한다. */
export function parseFormattedNumber(value: string): number {
  return Number(value.replace(/,/g, "")) || 0;
}
