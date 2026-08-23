// "메뉴 감지" 탭에서 캐릭터 이름을 이미지 등록 없이 화면에서 직접 읽어오기 위한 OCR.
// tesseract.js(WASM)를 브라우저에서 그대로 돌린다. 워커 초기화(+한국어 데이터 다운로드)가 몇 초 걸릴 수
// 있어서, 한 번 만든 워커를 모듈 스코프에 캐싱해서 재사용한다(스캔마다 새로 만들지 않음).

import Tesseract from "tesseract.js";

export type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };

let workerPromise: Promise<Tesseract.Worker> | null = null;

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("kor");
  }
  return workerPromise;
}

/** 그레이스케일로 바꾸고 밝기 대비를 최대로 늘린다(min~max를 0~255로 스트레칭). 게임 UI 텍스트는
 *  화려한 배경 위에 흐릿하게 떠 있는 경우가 많아서, 대비를 또렷하게 만들어주면 OCR 인식률이 꽤 올라간다. */
function enhanceContrast(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let min = 255;
  let max = 0;
  const gray = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const stretched = ((gray[p] - min) / range) * 255;
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }
  ctx.putImageData(imageData, 0, 0);
}

/** 프레임에서 crop 영역만 잘라, 작은 글자도 잘 읽히도록 확대 + 대비 강화해서 캔버스로 만든다. */
function cropRegionForOcr(source: CanvasImageSource, sourceW: number, sourceH: number, crop: CropPct): HTMLCanvasElement {
  const sw = crop.wPct * sourceW;
  const sh = crop.hPct * sourceH;
  const scale = Math.max(1, 320 / sw); // 원본이 너무 작으면 최소 폭 320px 정도로 확대
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, crop.xPct * sourceW, crop.yPct * sourceH, sw, sh, 0, 0, canvas.width, canvas.height);
  enhanceContrast(canvas);
  return canvas;
}

export async function recognizeRegionText(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropPct
): Promise<string> {
  const worker = await getWorker();
  const canvas = cropRegionForOcr(source, sourceW, sourceH, crop);
  // 캐릭터 이름은 보통 한 줄이지만, 결과화면 텍스트는 레이드에 따라 "레이드명"과 "[난이도]"가 서로 다른
  // 줄에 나오는 경우도 있어서(예: 세르카는 이름과 난이도가 2줄로 나뉨) "한 줄로 취급"하는 SINGLE_LINE은
  // 이런 크롭에서 줄이 뒤섞이거나 글자가 깨질 수 있다. 대신 "하나의 균일한 텍스트 블록"으로 보는
  // SINGLE_BLOCK을 쓰면 한 줄짜리 텍스트도 문제없이 읽히면서 여러 줄이 섞인 크롭에도 더 안정적이다.
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
  const { data } = await worker.recognize(canvas);
  return data.text.trim();
}

type OcrLine = { text: string; y: number };

/** blocks/paragraphs/lines 트리를 평평한 줄 목록으로 펼친다(줄마다 세로 중심 좌표 포함). */
function flattenLines(page: Tesseract.Page): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        lines.push({ text: line.text, y: (line.bbox.y0 + line.bbox.y1) / 2 });
      }
    }
  }
  return lines;
}

export type RaidRowStatus = { raidLabel: string; cleared: boolean };

// "레이드 참여 현황" 패널의 표기가 앱의 레이드 이름과 다른 경우가 있어서(예: 벨가르딘의 실제 화면 타이틀은
// "죽음의 계율자, 벨가르딘"이 아니라 참여 현황 패널에서는 "페투스 안 크라그마"), OCR로 읽은 텍스트 안에서
// 검색할 문자열을 따로 지정한다. 여기 없는 레이드는 앱 이름 그대로 찾아도 된다(예: 종막/4막/성당은 패널
// 표기에 앱 이름이 그대로 포함돼 있음 — "종막 : 카제로스", "4막 : 아르모체", "지평의 성당").
const PARTICIPATION_PANEL_SEARCH_TEXT: Record<string, string> = {
  벨가르딘: "크라그마",
  세르카: "코르부스",
};

/**
 * "레이드 참여 현황" 패널처럼 여러 줄이 한 화면에 같이 보이는 영역을 통째로 OCR로 읽어서, 등록해둔 레이드
 * 이름들이 몇 번째 줄에 있고 그 줄(또는 세로로 가까운 줄)에 "완료"가 같이 있는지로 클리어 여부를 판정한다.
 * 레이드 이름 줄과 완료 표시가 tesseract가 같은 줄로 묶을 수도, 아이콘 때문에 다른 줄로 쪼갤 수도 있어서
 * 텍스트 일치가 아니라 세로 위치가 가까운지로 상관관계를 본다 — 어느 쪽이든 결과가 맞게 나온다.
 */
export async function recognizeParticipationPanel(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropPct,
  raidLabels: string[]
): Promise<RaidRowStatus[]> {
  const worker = await getWorker();
  const canvas = cropRegionForOcr(source, sourceW, sourceH, crop);
  // 참여현황 패널은 아이콘/여백으로 뚝뚝 끊긴 여러 줄이라, "문서처럼 자동 분석"보다
  // "흩어진 텍스트를 순서 상관없이 최대한 찾아라"에 가까운 모드가 더 잘 맞는다.
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const lines = flattenLines(data);
  if (lines.length === 0) return [];

  // 한 행의 세로 폭을 대략 추정 — 최대 10행 정도 보인다고 가정 (탐색 여유를 위해 넉넉하게 잡음).
  const rowHeightEstimate = canvas.height / 10;
  const tolerance = rowHeightEstimate * 0.7;

  const results: RaidRowStatus[] = [];
  for (const raidLabel of raidLabels) {
    const searchText = PARTICIPATION_PANEL_SEARCH_TEXT[raidLabel] ?? raidLabel;
    const normSearch = normalize(searchText);
    if (!normSearch) continue;
    const nameLine = lines.find((l) => normalize(l.text).includes(normSearch));
    if (!nameLine) continue;

    const cleared = lines.some((l) => normalize(l.text).includes("완료") && Math.abs(l.y - nameLine.y) <= tolerance);
    results.push({ raidLabel, cleared });
  }
  return results;
}

function normalize(s: string): string {
  return s.replace(/[^가-힣a-zA-Z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** OCR로 읽은 텍스트(레벨 등 잡음이 섞여 있어도 됨)와 내 캐릭터 이름 목록을 비교해 가장 가까운 캐릭터를 찾는다. */
export function matchCharacterName<T extends { id: string; name: string }>(ocrText: string, characters: T[]): T | null {
  const normalizedOcr = normalize(ocrText);
  if (!normalizedOcr) return null;

  const contained = characters.find((c) => normalizedOcr.includes(normalize(c.name)));
  if (contained) return contained;

  let best: { character: T; dist: number } | null = null;
  for (const c of characters) {
    const name = normalize(c.name);
    if (!name) continue;
    const dist = levenshtein(normalizedOcr, name);
    if (!best || dist < best.dist) best = { character: c, dist };
  }
  // 이름 길이 대비 편집거리가 너무 크면(전혀 다른 글자면) 매칭 포기
  if (best && best.dist <= Math.max(1, Math.ceil(best.character.name.length * 0.34))) return best.character;
  return null;
}

// 레이드 진행 중에도 레이드명·난이도 제목 표시줄은 계속 떠 있어서(클리어 전후 안 바뀜), 이름+난이도만
// 읽히면 관문에 입장하자마자 바로 "클리어"로 오판하게 된다. 실제로 클리어했을 때만 바뀌는 건 그 아래
// 버튼이 "나가기"로 바뀌는 것이라, 이 텍스트가 같이 읽혀야 클리어로 인정한다(사용자가 실제 게임 화면으로
// 확인해준 내용). 처음엔 제목+체크마크+버튼을 한 크롭에 다 넣고 그 안에서 이 텍스트를 찾았는데, 체크마크
// 아이콘/버튼 테두리 같은 그래픽 요소가 같이 섞여 들어가면 OCR이 그 부분에서 자꾸 엉뚱한 글자를
// 만들어내서(예: "나가기"가 "또칼^" 같은 걸로 깨짐) 버튼 텍스트만 따로 좁게 등록하는 것도 지원한다
// (`matchesClearButtonText`).
const CLEAR_BUTTON_TEXT = normalize("나가기");

/** 버튼 영역 OCR 결과에 "나가기" 텍스트가 포함돼 있는지 확인한다 (별도로 좁게 등록한 크롭용). */
export function matchesClearButtonText(ocrText: string): boolean {
  return normalize(ocrText).includes(CLEAR_BUTTON_TEXT);
}

// 일부 레이드는 화면에 난이도가 "노말"이 아니라 "싱글 모드"로 표시되는데(사용자 확인: 컨텐츠 자체는
// 노말과 동일), DB의 난이도 값은 그대로 "노말"이라 OCR 텍스트만 별칭으로 같이 인정해준다.
const DIFFICULTY_ALIASES: Record<string, string[]> = {
  노말: ["싱글모드"],
};

function difficultyTextMatches(normalizedOcr: string, difficulty: string): boolean {
  if (normalizedOcr.includes(difficulty)) return true;
  return (DIFFICULTY_ALIASES[difficulty] ?? []).some((alias) => normalizedOcr.includes(alias));
}

// "성당"의 관문 클리어 제목은 앱에서 쓰는 짧은 이름이 아니라 "구원의 종탑"으로 뜬다(참여현황 패널의
// "지평의 성당"과는 다른 화면·다른 표기라 PARTICIPATION_PANEL_SEARCH_TEXT와는 별개로 여기도 필요함).
// 그 외 레이드는 결과화면 제목에 앱 이름이 그대로 포함돼 있어서 별도 별칭이 필요 없다.
const RAID_NAME_ALIASES: Record<string, string[]> = {
  성당: ["구원의종탑"],
};

function raidNameTextMatches(normalizedOcr: string, name: string): boolean {
  if (normalizedOcr.includes(name)) return true;
  return (RAID_NAME_ALIASES[name] ?? []).some((alias) => normalizedOcr.includes(alias));
}

/**
 * 결과화면에서 OCR로 읽은 텍스트("종막 : 최후의 날 [하드]" 등)와 레이드 목록을 비교해 어떤 레이드·난이도인지
 * 찾는다. 벨가르딘 나이트메어와 종막 하드처럼 배경/체크마크가 비슷한 화면은 픽셀 비교로 계속 헷갈렸는데,
 * 실제 글자를 읽으면 훨씬 정확하다. 레이드 이름과 난이도 둘 다 포함돼야 매칭으로 인정한다(하나만 맞으면
 * 오탐 가능성이 커서 일부러 엄격하게 함) — 이름은 `RAID_NAME_ALIASES`, 난이도는 `DIFFICULTY_ALIASES`로
 * 앱 이름과 실제 화면 표기가 다른 경우도 같이 인정한다. 클리어 여부("나가기" 버튼)는 이 함수가 아니라 호출하는 쪽에서
 * `matchesClearButtonText`로 별도 확인한다 — 제목/난이도만으론 클리어 전후 구분이 안 되기 때문에
 * (레이드 진행 중에도 항상 떠 있는 텍스트라서) 반드시 같이 확인해야 한다.
 */
export function matchRaidFromText<T extends { id: string; name: string; difficulty: string }>(
  ocrText: string,
  raids: T[]
): T | null {
  const normalizedOcr = normalize(ocrText);
  if (!normalizedOcr) return null;

  for (const r of raids) {
    const name = normalize(r.name);
    const difficulty = normalize(r.difficulty);
    if (name && difficulty && raidNameTextMatches(normalizedOcr, name) && difficultyTextMatches(normalizedOcr, difficulty)) {
      return r;
    }
  }
  return null;
}
