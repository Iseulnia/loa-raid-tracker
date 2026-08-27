// 로아 도구 > 보석 가격 탭에서 추적하는 겁화/작열의 보석 6종.
// gem_key는 gem_price_snapshots 테이블의 gem_key 컬럼과 그대로 맞춰서 쓴다.

export type GemDef = { key: string; name: string; level: number; kind: "겁화" | "작열" };

export const GEMS: GemDef[] = [
  { key: "gyeokhwa_8", name: "8레벨 겁화의 보석", level: 8, kind: "겁화" },
  { key: "jagyeol_8", name: "8레벨 작열의 보석", level: 8, kind: "작열" },
  { key: "gyeokhwa_9", name: "9레벨 겁화의 보석", level: 9, kind: "겁화" },
  { key: "jagyeol_9", name: "9레벨 작열의 보석", level: 9, kind: "작열" },
  { key: "gyeokhwa_10", name: "10레벨 겁화의 보석", level: 10, kind: "겁화" },
  { key: "jagyeol_10", name: "10레벨 작열의 보석", level: 10, kind: "작열" },
];
