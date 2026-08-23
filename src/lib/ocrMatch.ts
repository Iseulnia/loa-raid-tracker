// "메뉴 감지" 탭에서 캐릭터 이름을 이미지 등록 없이 화면에서 직접 읽어오기 위한 OCR.
// tesseract.js(WASM)를 브라우저에서 그대로 돌린다. 워커 초기화(+한국어 데이터 다운로드)가 몇 초 걸릴 수
// 있어서, 한 번 만든 워커를 모듈 스코프에 캐싱해서 재사용한다(스캔마다 새로 만들지 않음).

import Tesseract from "tesseract.js";

export type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };

/** getDisplayMedia에 넘기는 video 제약 조건. 브라우저는 화면공유를 인코딩할 때 대역폭을 아끼려고 프레임을
 *  압축하는데, OCR은 어차피 몇 초에 한 번만 프레임을 읽으면 되니 프레임레이트를 낮게 요청하면 인코더가
 *  프레임 하나에 더 많은 비트를 쓸 수 있어서 캐릭터 이름 같은 작은 글자가 더 또렷하게 잡힌다. 해상도도
 *  명시적으로 높게 요청해서 브라우저가 임의로 다운스케일하지 않도록 한다. 화면공유/기준 영역 등록/자동
 *  감지/메뉴 감지가 전부 같은 값을 쓰도록 여기 한 곳에서만 관리한다. */
export const SCREEN_CAPTURE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 3840 },
  height: { ideal: 2160 },
  frameRate: { ideal: 5, max: 10 },
};

let workerPromise: Promise<Tesseract.Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
// 워커를 켜둔 채로 방치하면(자동 감지/메뉴 감지 탭을 한 번이라도 켰다가 다른 탭으로 옮기거나 화면공유를
// 꺼도) WASM 워커가 브라우저 탭이 살아있는 내내 메모리에 남는다. 일정 시간 인식 요청이 없으면 종료해서
// 메모리를 돌려주고, 다음에 다시 필요해지면 그때 새로 띄운다(재초기화 몇 초는 감수).
const WORKER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("kor");
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const toTerminate = workerPromise;
    workerPromise = null;
    idleTimer = null;
    toTerminate?.then((w) => w.terminate()).catch(() => {});
  }, WORKER_IDLE_TIMEOUT_MS);
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

// OCR로 실제 글자 크기를 미리 재서 배율을 정하는 건 불가능하다(그러려면 이미 OCR이 한 번 성공해야 하는
// 순환 문제라서). 대신 "충분히 크게 확대해두면 원본 글자가 작아도 상관없다"는 접근으로, 폭·높이 둘 다
// 넉넉한 최소 크기를 보장한다. 폭만 기준으로 삼으면 크롭이 가로로 넓고 얇을 때(이름표처럼) 세로 해상도가
// 부족할 수 있어서 높이 기준도 같이 둠.
const MIN_OCR_WIDTH_PX = 400;
const MIN_OCR_HEIGHT_PX = 100;

/** 캔버스 안에서 배경과 뚜렷이 다른("잉크") 픽셀만 찾아 그 부분만 감싸는 사각형으로 잘라낸다. 긴 닉네임도
 *  담을 수 있도록 일부러 넓게 등록한 캐릭터 이름 크롭은, 실제 이름이 짧을 때 오른쪽에 남는 빈 여백이나
 *  다른 UI 요소가 그대로 같이 확대되면서 정작 글자의 실효 해상도를 깎아먹는다. 배경 값은 전체 픽셀 중
 *  가장 흔한 밝기(히스토그램 최빈값)로 추정한다 — 크롭 대부분은 배경이고 글자는 소수라 이 값이 배경에
 *  가장 안정적으로 수렴한다. 잉크가 하나도 안 잡히면(전부 배경) 원본을 그대로 돌려준다. */
function trimToInk(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = canvas;
  if (width < 4 || height < 4) return canvas;
  const ctx = canvas.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, width, height);

  const BUCKETS = 32;
  const hist = new Array(BUCKETS).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    hist[Math.min(BUCKETS - 1, Math.floor((data[i] / 256) * BUCKETS))]++;
  }
  const bgBucket = hist.indexOf(Math.max(...hist));
  const bg = (bgBucket + 0.5) * (256 / BUCKETS);
  const INK_THRESHOLD = 45;

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[(y * width + x) * 4];
      if (Math.abs(v - bg) > INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return canvas;

  // 글자 획이 잘리지 않도록 살짝 여백을 남긴다(세로는 자음/모음 위아래로 더 여유 있게).
  const padX = Math.max(2, Math.round((maxX - minX) * 0.06));
  const padY = Math.max(2, Math.round((maxY - minY) * 0.25));
  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padY);
  const cropW = Math.min(width, maxX + padX + 1) - cropX;
  const cropH = Math.min(height, maxY + padY + 1) - cropY;
  if (cropW < 2 || cropH < 2) return canvas;

  const trimmed = document.createElement("canvas");
  trimmed.width = cropW;
  trimmed.height = cropH;
  trimmed.getContext("2d")!.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return trimmed;
}

/** 프레임에서 crop 영역만 잘라, 작은 글자도 잘 읽히도록 확대 + 대비 강화해서 캔버스로 만든다.
 *  mode "line"(캐릭터 이름)은 대비 강화 후 실제 글자가 있는 부분만 자동으로 좁혀서(`trimToInk`) 그
 *  부분을 기준으로 확대 배율을 계산한다 — 긴 닉네임을 담으려고 넓게 등록한 크롭이어도, 짧은 이름일 때
 *  남는 빈 공간이 확대 배율을 갉아먹지 않게 하기 위함. mode "block"(결과화면 등)은 위치가 항상 일정하고
 *  둘째 줄(난이도)까지 걸쳐 있을 수 있어 자동으로 좁히면 오히려 위험해서 트리밍 없이 크롭 전체를 쓴다. */
function cropRegionForOcr(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropPct,
  mode: "line" | "block" = "block"
): HTMLCanvasElement {
  const sw = crop.wPct * sourceW;
  const sh = crop.hPct * sourceH;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = Math.max(1, Math.round(sw));
  rawCanvas.height = Math.max(1, Math.round(sh));
  const rawCtx = rawCanvas.getContext("2d")!;
  rawCtx.drawImage(source, crop.xPct * sourceW, crop.yPct * sourceH, sw, sh, 0, 0, rawCanvas.width, rawCanvas.height);
  enhanceContrast(rawCanvas);

  const trimmed = mode === "line" ? trimToInk(rawCanvas) : rawCanvas;

  const scale = Math.max(1, MIN_OCR_WIDTH_PX / trimmed.width, MIN_OCR_HEIGHT_PX / trimmed.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(trimmed.width * scale);
  canvas.height = Math.round(trimmed.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(trimmed, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * @param mode "line": 캐릭터 이름처럼 원래부터 한 줄인 텍스트(SINGLE_LINE — 여러 줄일 가능성이 없는
 *   짧은 UI 라벨에선 이 모드가 더 정확함, 실제 글자 부분만 자동으로 좁혀서 확대함). "block"(기본값):
 *   결과화면 텍스트처럼 레이드에 따라 두 줄로 나뉘거나 아이콘이 섞일 수 있는 크롭(SINGLE_BLOCK — 한 줄이든
 *   여러 줄이든 무난하게 읽히지만, 진짜 한 줄짜리 짧은 텍스트에서는 SINGLE_LINE보다 살짝 부정확할 수 있음).
 */
export async function recognizeRegionText(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropPct,
  mode: "line" | "block" = "block"
): Promise<string> {
  const worker = await getWorker();
  const canvas = cropRegionForOcr(source, sourceW, sourceH, crop, mode);
  const psm = mode === "line" ? Tesseract.PSM.SINGLE_LINE : Tesseract.PSM.SINGLE_BLOCK;
  await worker.setParameters({ tessedit_pageseg_mode: psm });
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

function fuzzyThreshold(nameLength: number): number {
  return Math.max(1, Math.ceil(nameLength * 0.34));
}

/** 서로 이름이 아주 비슷한 캐릭터들끼리는(예: 키츠네아/키츠녜아/키츄네아처럼 한두 글자만 다름) OCR이
 *  한 글자만 잘못 읽어도 여러 후보가 동시에 "그럴듯하게" 가까워져서, 편집거리가 제일 작은 것 하나만 보고
 *  확정하면 오히려 엉뚱한 캐릭터로 잘못 매칭될 위험이 크다(잘못된 캐릭터에 체크가 들어가는 건 자동 인식
 *  실패보다 훨씬 나쁨). 그래서 내 캐릭터 목록 안에서 서로 fuzzy 매칭 기준으로 헷갈릴 만큼 가까운 이름들은
 *  미리 찾아두고, 그런 이름들은 fuzzy 매칭 대상에서 아예 빼서 정확히 일치할 때만(아래 `contained` 체크)
 *  인정하게 한다. 남과 안 헷갈리는 이름은 기존처럼 fuzzy 매칭을 그대로 적용한다. */
function findConfusableNames(normalizedNames: string[]): Set<string> {
  const confusable = new Set<string>();
  for (let i = 0; i < normalizedNames.length; i++) {
    for (let j = i + 1; j < normalizedNames.length; j++) {
      const a = normalizedNames[i];
      const b = normalizedNames[j];
      if (!a || !b || a === b) continue;
      if (levenshtein(a, b) <= fuzzyThreshold(Math.min(a.length, b.length))) {
        confusable.add(a);
        confusable.add(b);
      }
    }
  }
  return confusable;
}

/** OCR로 읽은 텍스트(레벨 등 잡음이 섞여 있어도 됨)와 내 캐릭터 이름 목록을 비교해 가장 가까운 캐릭터를 찾는다. */
export function matchCharacterName<T extends { id: string; name: string }>(ocrText: string, characters: T[]): T | null {
  const normalizedOcr = normalize(ocrText);
  if (!normalizedOcr) return null;

  const contained = characters.find((c) => normalizedOcr.includes(normalize(c.name)));
  if (contained) return contained;

  const confusableNames = findConfusableNames(characters.map((c) => normalize(c.name)));

  let best: { character: T; dist: number } | null = null;
  for (const c of characters) {
    const name = normalize(c.name);
    if (!name || confusableNames.has(name)) continue;
    const dist = levenshtein(normalizedOcr, name);
    if (!best || dist < best.dist) best = { character: c, dist };
  }
  // 이름 길이 대비 편집거리가 너무 크면(전혀 다른 글자면) 매칭 포기
  if (best && best.dist <= fuzzyThreshold(best.character.name.length)) return best.character;
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
// "하드"는 실제 표기가 아니라 OCR이 자주 "하트"로 잘못 읽는 문제라(ㄷ/ㅌ이 흐릿하면 헷갈리기 쉬움) 같이
// 별칭 처리한다 — 다른 난이도(노말/나이트메어/1~3단계)와는 글자가 충분히 달라서 오탐 위험이 낮다. 다만
// 성당의 1단계/2단계/3단계처럼 숫자 하나 차이인 값들에는 이런 "비슷한 글자 허용" 방식을 넓게 적용하면
// 서로 잘못 매칭될 위험이 있어서, 여기서는 흔한 오독 패턴만 콕 집어 별칭으로 추가하는 방식을 유지한다.
const DIFFICULTY_ALIASES: Record<string, string[]> = {
  노말: ["싱글모드"],
  하드: ["하트"],
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
