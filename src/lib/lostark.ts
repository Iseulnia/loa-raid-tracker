// 로스트아크 공식 오픈 API 클라이언트 (서버에서만 호출; 키를 클라이언트에 노출하지 않는다).
// 문서: https://developer-lostark.game.onstove.com/
//
// 주의: 이 API는 "캐릭터가 이번 주 레이드를 클리어했는지" 는 제공하지 않는다.
// 여기서는 원정대(같은 계정) 캐릭터 목록과 아이템 레벨만 자동으로 가져오는 데 사용한다.

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
    `${BASE_URL}/armories/characters/${encodeURIComponent(characterName)}/siblings`,
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

/** "1,700.00" 같은 문자열을 숫자로 변환한다. */
export function parseItemLevel(value: string): number {
  return Number(value.replace(/,/g, "")) || 0;
}
