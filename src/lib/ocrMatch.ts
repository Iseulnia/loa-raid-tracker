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

/** 프레임에서 crop 영역만 잘라, 작은 글자도 잘 읽히도록 확대해서 캔버스로 만든다. */
function cropRegionForOcr(source: CanvasImageSource, sourceW: number, sourceH: number, crop: CropPct): HTMLCanvasElement {
  const sw = crop.wPct * sourceW;
  const sh = crop.hPct * sourceH;
  const scale = Math.max(1, 240 / sw); // 원본이 너무 작으면 최소 폭 240px 정도로 확대
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, crop.xPct * sourceW, crop.yPct * sourceH, sw, sh, 0, 0, canvas.width, canvas.height);
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
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const lines = flattenLines(data);
  if (lines.length === 0) return [];

  // 한 행의 세로 폭을 대략 추정 — 최대 10행 정도 보인다고 가정 (탐색 여유를 위해 넉넉하게 잡음).
  const rowHeightEstimate = canvas.height / 10;
  const tolerance = rowHeightEstimate * 0.7;

  const results: RaidRowStatus[] = [];
  for (const raidLabel of raidLabels) {
    const normLabel = normalize(raidLabel);
    if (!normLabel) continue;
    const nameLine = lines.find((l) => normalize(l.text).includes(normLabel));
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

/**
 * 결과화면에서 OCR로 읽은 텍스트("종막 : 최후의 날 [하드]" 등)와 레이드 목록을 비교해 어떤 레이드·난이도인지
 * 찾는다. 벨가르딘 나이트메어와 종막 하드처럼 배경/체크마크가 비슷한 화면은 픽셀 비교로 계속 헷갈렸는데,
 * 실제 글자를 읽으면 훨씬 정확하다. 레이드 이름과 난이도 둘 다 텍스트에 포함돼야 매칭으로 인정한다
 * (하나만 맞으면 오탐 가능성이 커서 일부러 엄격하게 함 — 못 찾으면 다음 프레임에 다시 시도하면 되므로).
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
    if (name && difficulty && normalizedOcr.includes(name) && normalizedOcr.includes(difficulty)) {
      return r;
    }
  }
  return null;
}
