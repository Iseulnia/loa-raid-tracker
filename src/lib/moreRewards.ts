// 더보기(레이드 추가 보상 구매) 골드/보상 표. 출처: 사용자가 정리해둔 스프레드시트(관문별 실측치).
// 패치로 수치가 바뀌면 이 파일만 고치면 된다(코드에 흩어져 있지 않게 한 군데로 모음).

export type MaterialKey =
  | "destructionStone"
  | "guardianStone"
  | "breakthroughStone"
  | "destructionCrystal"
  | "guardianCrystal"
  | "greatBreakthroughStone";

export type MarketItemRef = { name: string; marketItemId: number; bundleCount: number };

// marketItemId/bundleCount는 로스트아크 거래소 API(카테고리 50010=재련 재료)에서 직접 확인한 값.
export const MATERIAL_ITEMS: Record<MaterialKey, MarketItemRef> = {
  destructionStone: { name: "운명의 파괴석", marketItemId: 66102006, bundleCount: 100 },
  guardianStone: { name: "운명의 수호석", marketItemId: 66102106, bundleCount: 100 },
  breakthroughStone: { name: "운명의 돌파석", marketItemId: 66110225, bundleCount: 1 },
  destructionCrystal: { name: "운명의 파괴석 결정", marketItemId: 66102007, bundleCount: 100 },
  guardianCrystal: { name: "운명의 수호석 결정", marketItemId: 66102107, bundleCount: 100 },
  greatBreakthroughStone: { name: "위대한 운명의 돌파석", marketItemId: 66110226, bundleCount: 1 },
};

// 운명의 파편은 그 자체로 거래되지 않고 "파편 주머니"로만 거래된다(주머니는 낱개 거래, BundleCount 1).
// 소/중/대가 각각 1000/2000/3000개를 주므로, 개당 단가는 가격을 저 수량으로 나눠서 계산하고
// 그중 제일 싼 주머니를 기준으로 삼는다.
export const FRAGMENT_POUCHES: (MarketItemRef & { fragmentsPerPouch: number })[] = [
  { name: "운명의 파편 주머니(소)", marketItemId: 66130141, bundleCount: 1, fragmentsPerPouch: 1000 },
  { name: "운명의 파편 주머니(중)", marketItemId: 66130142, bundleCount: 1, fragmentsPerPouch: 2000 },
  { name: "운명의 파편 주머니(대)", marketItemId: 66130143, bundleCount: 1, fragmentsPerPouch: 3000 },
];

export type MoreRewardGate = {
  raid: string;
  difficulty: string;
  gate: string;
  gold: number;
  fragment: number;
  materials: Partial<Record<MaterialKey, number>>;
};

export const MORE_REWARD_GATES: MoreRewardGate[] = [
  { raid: "4막", difficulty: "노말", gate: "1관문", gold: 3200, fragment: 9510, materials: { destructionStone: 1120, guardianStone: 2240, breakthroughStone: 36 } },
  { raid: "4막", difficulty: "노말", gate: "2관문", gold: 5440, fragment: 16720, materials: { destructionStone: 2000, guardianStone: 4000, breakthroughStone: 65 } },
  { raid: "4막", difficulty: "하드", gate: "1관문", gold: 4320, fragment: 12830, materials: { destructionStone: 1520, guardianStone: 3040, breakthroughStone: 48 } },
  { raid: "4막", difficulty: "하드", gate: "2관문", gold: 7840, fragment: 21960, materials: { destructionStone: 2620, guardianStone: 5240, breakthroughStone: 86 } },

  { raid: "종막", difficulty: "노말", gate: "1관문", gold: 3520, fragment: 10730, materials: { destructionStone: 1270, guardianStone: 2540, breakthroughStone: 40 } },
  { raid: "종막", difficulty: "노말", gate: "2관문", gold: 6720, fragment: 18740, materials: { destructionStone: 2230, guardianStone: 4460, breakthroughStone: 73 } },
  { raid: "종막", difficulty: "하드", gate: "1관문", gold: 5120, fragment: 16480, materials: { destructionCrystal: 710, guardianCrystal: 1420, greatBreakthroughStone: 29 } },
  { raid: "종막", difficulty: "하드", gate: "2관문", gold: 10240, fragment: 27250, materials: { destructionCrystal: 1210, guardianCrystal: 2420, greatBreakthroughStone: 46 } },

  { raid: "세르카", difficulty: "노말", gate: "1관문", gold: 4160, fragment: 12680, materials: { destructionStone: 1500, guardianStone: 3000, breakthroughStone: 47 } },
  { raid: "세르카", difficulty: "노말", gate: "2관문", gold: 6080, fragment: 18900, materials: { destructionStone: 2250, guardianStone: 4500, breakthroughStone: 75 } },
  { raid: "세르카", difficulty: "하드", gate: "1관문", gold: 5600, fragment: 17500, materials: { destructionCrystal: 750, guardianCrystal: 1500, greatBreakthroughStone: 30 } },
  { raid: "세르카", difficulty: "하드", gate: "2관문", gold: 8480, fragment: 26820, materials: { destructionCrystal: 1130, guardianCrystal: 2260, greatBreakthroughStone: 45 } },
  { raid: "세르카", difficulty: "나이트메어", gate: "1관문", gold: 6720, fragment: 19000, materials: { destructionCrystal: 860, guardianCrystal: 1720, greatBreakthroughStone: 36 } },
  { raid: "세르카", difficulty: "나이트메어", gate: "2관문", gold: 10560, fragment: 32200, materials: { destructionCrystal: 1430, guardianCrystal: 2860, greatBreakthroughStone: 60 } },

  { raid: "성당", difficulty: "1단계", gate: "1관문", gold: 4320, fragment: 11880, materials: { destructionStone: 1400, guardianStone: 2800, breakthroughStone: 44 } },
  { raid: "성당", difficulty: "1단계", gate: "2관문", gold: 5280, fragment: 20160, materials: { destructionStone: 2400, guardianStone: 4800, breakthroughStone: 78 } },
  { raid: "성당", difficulty: "2단계", gate: "1관문", gold: 5120, fragment: 14250, materials: { destructionStone: 1680, guardianStone: 3360, breakthroughStone: 53 } },
  { raid: "성당", difficulty: "2단계", gate: "2관문", gold: 7680, fragment: 24200, materials: { destructionStone: 2880, guardianStone: 5760, breakthroughStone: 94 } },
  { raid: "성당", difficulty: "3단계", gate: "1관문", gold: 6400, fragment: 19000, materials: { destructionCrystal: 860, guardianCrystal: 1720, greatBreakthroughStone: 36 } },
  { raid: "성당", difficulty: "3단계", gate: "2관문", gold: 9600, fragment: 32200, materials: { destructionCrystal: 1430, guardianCrystal: 2860, greatBreakthroughStone: 60 } },

  { raid: "벨가르딘", difficulty: "노말", gate: "1관문", gold: 6400, fragment: 19000, materials: { destructionCrystal: 860, guardianCrystal: 1720, greatBreakthroughStone: 36 } },
  { raid: "벨가르딘", difficulty: "노말", gate: "2관문", gold: 9600, fragment: 32200, materials: { destructionCrystal: 1430, guardianCrystal: 2860, greatBreakthroughStone: 60 } },
  { raid: "벨가르딘", difficulty: "하드", gate: "1관문", gold: 8000, fragment: 22800, materials: { destructionCrystal: 1130, guardianCrystal: 2260, greatBreakthroughStone: 43 } },
  { raid: "벨가르딘", difficulty: "하드", gate: "2관문", gold: 11840, fragment: 38640, materials: { destructionCrystal: 1720, guardianCrystal: 3440, greatBreakthroughStone: 72 } },
  { raid: "벨가르딘", difficulty: "나이트메어", gate: "1관문", gold: 9600, fragment: 26220, materials: { destructionCrystal: 1300, guardianCrystal: 2600, greatBreakthroughStone: 49 } },
  { raid: "벨가르딘", difficulty: "나이트메어", gate: "2관문", gold: 14400, fragment: 44440, materials: { destructionCrystal: 1980, guardianCrystal: 3960, greatBreakthroughStone: 83 } },
];
