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
