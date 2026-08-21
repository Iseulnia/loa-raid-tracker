// 직업 각인(ArkPassive Title) 기준 서포터/딜러 분류.
// 서포터 4종 각인 외에는 전부 딜러 각인으로 취급한다.
const SUPPORT_ENGRAVINGS = new Set(["축복의 오라", "절실한 구원", "만개", "해방자"]);

export function isSupportEngraving(engraving: string | null): boolean {
  return engraving !== null && SUPPORT_ENGRAVINGS.has(engraving);
}
