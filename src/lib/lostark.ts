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

export type MarketItem = {
  Id: number;
  Name: string;
  Grade: string;
  BundleCount: number; // 묶음 거래 수량(예: 100). CurrentMinPrice는 1개가 아니라 이 묶음 전체 가격이다.
  CurrentMinPrice: number;
  YDayAvgPrice: number;
  RecentPrice: number;
};

/** 거래소 카테고리 하나(예: 재련 재료=50010)의 아이템을 전부 가져온다. 이름 검색(ItemName)은 완전
 *  일치라 이름이 조금만 달라도 못 찾기 쉬워서, 카테고리 전체를 가져와 Id로 매칭하는 쪽이 안전하다
 *  (재련 재료 카테고리는 30여 개뿐이라 페이지 몇 장으로 끝남). */
export async function searchMarketItemsByCategory(categoryCode: number): Promise<MarketItem[]> {
  const items: MarketItem[] = [];
  let pageNo = 1;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${BASE_URL}/markets/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        Sort: "CURRENT_MIN_PRICE",
        CategoryCode: categoryCode,
        PageNo: pageNo,
        SortCondition: "ASC",
      }),
      cache: "no-store",
    });

    if (res.status === 401) {
      throw new LostArkApiError("API 키가 올바르지 않거나 만료됐어요.", 401);
    }
    if (!res.ok) {
      throw new LostArkApiError(`로스트아크 거래소 API 호출 실패 (status ${res.status})`, res.status);
    }

    const data = (await res.json()) as { Items: MarketItem[] | null; TotalCount: number };
    const pageItems = data.Items ?? [];
    items.push(...pageItems);
    if (pageItems.length === 0 || items.length >= data.TotalCount) break;
    pageNo += 1;
  }
  return items;
}

// 겁화/작열의 보석은 거래소(markets)가 아니라 경매장(auctions) 아이템 — 장비처럼 매물마다 다른 랜덤
// 옵션(어떤 스킬에 붙는지)이 붙어서 거래소식 "고정 아이템 하나에 시세 하나" 구조가 아니라 개별 매물
// 목록으로 나온다. 경매장 카테고리 코드는 markets와 다른 체계(보석=210000)를 쓴다.
const AUCTION_GEM_CATEGORY_CODE = 210000;

/** 이름이 정확히 일치하는 경매장 매물들 중 즉시 구매가 있는 것만 모아 최저가를 반환한다.
 *  매물이 없거나 전부 즉시구매 불가(입찰만 가능)면 null. */
export async function searchAuctionLowestBuyPrice(itemName: string): Promise<number | null> {
  const res = await fetch(`${BASE_URL}/auctions/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ItemLevelMin: 0,
      ItemLevelMax: 1800,
      ItemGradeQuality: 0,
      SkillOptions: [],
      EtcOptions: [],
      Sort: "BUY_PRICE",
      CategoryCode: AUCTION_GEM_CATEGORY_CODE,
      CharacterClass: "",
      ItemTier: 4,
      ItemGrade: "",
      ItemName: itemName,
      PageNo: 1,
      SortCondition: "ASC",
    }),
    cache: "no-store",
  });

  if (res.status === 401) {
    throw new LostArkApiError("API 키가 올바르지 않거나 만료됐어요.", 401);
  }
  if (!res.ok) {
    throw new LostArkApiError(`로스트아크 경매장 API 호출 실패 (status ${res.status})`, res.status);
  }

  const data = (await res.json()) as { Items: { AuctionInfo: { BuyPrice: number } }[] | null };
  const buyPrices = (data.Items ?? [])
    .map((it) => it.AuctionInfo.BuyPrice)
    .filter((price) => price > 0);
  if (buyPrices.length === 0) return null;
  return Math.min(...buyPrices);
}
