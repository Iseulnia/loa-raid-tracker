// 로스트아크 공식 홈페이지 아트워크 갤러리(lostark.game.onstove.com/Artwork)에서
// 클래스 이름과 일치하는 게시물 중 가장 최신 날짜의 썸네일을 가져온 것.
// 배너용 원본이라 정사각형이 아니라서, 화면에서는 object-cover로 위쪽 위주로 잘라서 보여준다.
export const CLASS_ICON_URL: Record<string, string> = {
  // 전사
  버서커: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/6e09491a81d34063abd4fc5e4cf79252.jpg",
  디스트로이어: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/b88b5359c8ec489d828fc56c843f8c4d.jpg",
  워로드: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/1253df3b56de4ec8938b7ec0fbfc589c.jpg",
  홀리나이트: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/a4eaeb31f0d3463ab611d4b7e455ef98.jpg",
  슬레이어: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/afeeea9a33a04284a01a4f8ccd36a310.jpg",
  가디언나이트: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/a4e4799e568b4a3bbfed3bfa35745112.jpg",

  // 무도가
  인파이터: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/39da33e27efa4be688f8922d74bfc314.jpg",
  배틀마스터: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/5ff291384c304071b88836b9e1f48e66.jpg",
  창술사: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/c6031d008e934402bc3bb6024573b042.jpg",
  기공사: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/2597981b80074eb49c30bd66e7601c30.jpg",
  브레이커: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/d7089d42614e4880a4450a3cb2239577.jpg",

  // 헌터
  데빌헌터: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/1f5dce4dbe5044fc803c9d8369e36542.jpg",
  블래스터: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/6ff2cf05b4774cdd8e50799e00d48f02.jpg",
  호크아이: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/39910122ea4043359d8c58fa1ae691bc.jpg",
  스카우터: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/589abf945ab7492db7883ec30116e4d8.jpg",
  건슬링어: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/c9fc4f73aa324bbdad70255c483e11f3.jpg",

  // 마법사
  바드: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/c309a9bc19554f49a45ad92f029c8f31.jpg",
  서머너: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/dea1832143d54410bc0cf368842108a8.jpg",
  아르카나: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/0ec851c8640249d08e0862517d336ff7.jpg",
  소서리스: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/ddab54be855e49babc34149e66b4c25f.jpg",

  // 어쌔신
  데모닉: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/4542c5477f4d47ca9563c92263640f7a.jpg",
  리퍼: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/d772c37851724e9ba8d27fdc18b59da3.jpg",
  소울이터: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/0ff1543c0b004d7cbf3ec4768e85b4a5.jpg",

  // 스페셜리스트
  도화가: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/66251e5b4db94e67a870748035433651.jpg",
  기상술사: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/b13c1b41b62340838a7672bc38025229.jpg",
  환수사: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/854638d114b149c89c04e0484c328f20.jpg",

  // 신규 (2026.07 추가) — 아트워크가 영상이라 임시로 예고 이미지 썸네일 사용 중, 나중에 진짜 일러스트로 교체 필요
  차원술사: "https://cdn-lostark.game.onstove.com/uploadfiles/banner/2026/8fa2c1257f3e4572a8130233e70714a1.jpg",
};

export function getClassIconUrl(className: string | null): string | null {
  if (!className) return null;
  return CLASS_ICON_URL[className] ?? null;
}
