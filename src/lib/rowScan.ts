// "레이드 참여 현황" 패널처럼 스크롤에 따라 각 행의 화면 위치가 바뀌는 목록에서 특정 레이드 이름표가
// 지금 프레임의 어느 세로 위치에 있는지 찾기 위한 세로 슬라이딩 윈도우 검색.
// 한 스캔 틱마다 여러 세로 위치 후보를 반복 비교해야 해서, 해상도를 낮추고 계산을 가볍게 유지해 랙 없이
// 도는 걸 우선한다.

export type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };

const ROW_SAMPLE_WIDTH = 72;
const SEARCH_STEP_PX = 10;

function sampleHeightFor(crop: CropPct): number {
  const ratio = crop.hPct / crop.wPct;
  return Math.max(10, Math.min(120, Math.round(ROW_SAMPLE_WIDTH * ratio)));
}

function sampleRegion(source: CanvasImageSource, sourceW: number, sourceH: number, crop: CropPct): ImageData {
  const outW = ROW_SAMPLE_WIDTH;
  const outH = sampleHeightFor(crop);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    source,
    crop.xPct * sourceW,
    crop.yPct * sourceH,
    crop.wPct * sourceW,
    crop.hPct * sourceH,
    0,
    0,
    outW,
    outH
  );
  return ctx.getImageData(0, 0, outW, outH);
}

/** 저장된 템플릿 이미지(이미 이름표만큼 잘려서 저장된 파일) 전체를 같은 크기로 리샘플링한다. */
export function sampleNameTemplate(img: HTMLImageElement, crop: CropPct): ImageData {
  const outW = ROW_SAMPLE_WIDTH;
  const outH = sampleHeightFor(crop);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}

function grayscale(data: ImageData): Float32Array {
  const px = data.data;
  const out = new Float32Array(data.width * data.height);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    out[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  return out;
}

function edgeMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + width] - gray[i - width];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** 글자 모양(경계) 위주로 비교 — 배경색보다 텍스트 형태 차이에 민감해야 다른 레이드 이름과 안 헷갈림. */
function rowSimilarity(a: ImageData, b: ImageData): number {
  const edgeA = edgeMagnitude(grayscale(a), a.width, a.height);
  const edgeB = edgeMagnitude(grayscale(b), b.width, b.height);
  const len = Math.min(edgeA.length, edgeB.length);
  let diff = 0;
  for (let i = 0; i < len; i++) diff += Math.abs(edgeA[i] - edgeB[i]);
  const maxDiffPerPixel = 255 * Math.SQRT2;
  return 1 - Math.min(1, diff / (len * maxDiffPerPixel));
}

export type RowSearchResult = { yPct: number; score: number };

/** nameTemplate이 현재 프레임의 어느 세로 위치에 있는지 슬라이딩 윈도우로 찾는다.
 *  x/w/h 비율은 캡처 당시 그대로 고정하고 y만 위아래로 이동시키며 비교한다. */
export function findBestRowMatch(
  frame: CanvasImageSource,
  frameW: number,
  frameH: number,
  nameTemplate: ImageData,
  nameCrop: CropPct
): RowSearchResult | null {
  const stepPct = SEARCH_STEP_PX / frameH;
  const maxYPct = Math.max(0, 1 - nameCrop.hPct);
  let best: RowSearchResult | null = null;
  for (let yPct = 0; yPct <= maxYPct; yPct += stepPct) {
    const candidate = sampleRegion(frame, frameW, frameH, { ...nameCrop, yPct });
    const score = rowSimilarity(candidate, nameTemplate);
    if (!best || score > best.score) best = { yPct, score };
  }
  return best;
}

/** 배지 영역을 프레임에서 그대로 잘라 색상 판정용 원본 픽셀을 가져온다 (경계 비교 없이 색상만 봄). */
export function sampleBadgeRegion(frame: CanvasImageSource, frameW: number, frameH: number, crop: CropPct): ImageData {
  return sampleRegion(frame, frameW, frameH, crop);
}

/** "참여 완료" 배지는 뚜렷한 초록색 체크 아이콘이라, 초록이 우세한 픽셀 비율로 완료 여부를 판정한다. */
export function greenFraction(data: ImageData): number {
  const px = data.data;
  let greenCount = 0;
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    total++;
    if (g > 60 && g > r + 20 && g > b + 20) greenCount++;
  }
  return total === 0 ? 0 : greenCount / total;
}
