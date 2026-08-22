// 화면공유로 받은 라이브 프레임과 저장된 기준 이미지(템플릿)를 비교하는 가벼운 클라이언트 사이드 이미지 매칭.
// 무거운 CV 라이브러리 없이 Canvas만으로 "정규화된 픽셀 유사도"를 계산한다.
// 게임 UI는 사진이 아니라 렌더링된 화면이라 이 정도로도 꽤 잘 구분된다.

export type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };

// 결과화면끼리는 배경/체크마크/버튼이 거의 동일하고 레이드명 글자만 다른데, 해상도가 너무 낮으면
// 그 글자가 몇 픽셀로 뭉개져서 색상 평균만으로는 구분이 잘 안 된다 (오탐의 근본 원인). 해상도를 올려서
// 글자 디테일을 좀 더 보존한다.
const SAMPLE_WIDTH = 160;

function sampleHeightFor(crop: CropPct): number {
  const ratio = crop.hPct / crop.wPct;
  return Math.max(24, Math.min(260, Math.round(SAMPLE_WIDTH * ratio)));
}

/** 비디오/캔버스 프레임에서 crop 영역만 잘라 고정 크기로 리샘플링한 ImageData를 만든다. */
export function sampleFrameCrop(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: CropPct
): ImageData {
  const outW = SAMPLE_WIDTH;
  const outH = sampleHeightFor(crop);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  const sx = crop.xPct * sourceW;
  const sy = crop.yPct * sourceH;
  const sw = crop.wPct * sourceW;
  const sh = crop.hPct * sourceH;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}

/** 템플릿 이미지 전체(이미 그 crop만큼 잘려서 저장된 파일)를 같은 고정 크기로 리샘플링한다. */
export function sampleTemplateImage(img: HTMLImageElement, crop: CropPct): ImageData {
  const outW = SAMPLE_WIDTH;
  const outH = sampleHeightFor(crop);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}

/** RGB ImageData를 그레이스케일 배열로 변환. */
function toGrayscale(data: ImageData): Float32Array {
  const px = data.data;
  const out = new Float32Array(data.width * data.height);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    out[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  return out;
}

/** 단순 그라디언트 크기(소벨류) — 배경의 완만한 색 변화보다 글자/아이콘 테두리 같은 뚜렷한 경계를 부각시킨다. */
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

/**
 * 0(완전히 다름) ~ 1(동일) 사이의 유사도.
 * 색상 차이(전체적인 톤)와 경계 차이(글자/아이콘 모양)를 함께 보되, 경계 쪽에 더 큰 비중을 준다.
 * 결과화면들은 배경·체크마크·버튼이 레이드마다 거의 동일해서 색상만 비교하면 다른 레이드끼리도
 * 높은 점수가 나올 수 있는데, 실제 차이는 레이드명 "글자 모양"에 있으므로 경계 비교가 훨씬 잘 구분한다.
 */
export function similarity(a: ImageData, b: ImageData): number {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);

  const d1 = a.data;
  const d2 = b.data;
  let colorDiffSum = 0;
  let colorCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i1 = (y * a.width + x) * 4;
      const i2 = (y * b.width + x) * 4;
      const dr = d1[i1] - d2[i2];
      const dg = d1[i1 + 1] - d2[i2 + 1];
      const db = d1[i1 + 2] - d2[i2 + 2];
      colorDiffSum += Math.sqrt(dr * dr + dg * dg + db * db);
      colorCount++;
    }
  }
  const maxColorDiffPerPixel = Math.sqrt(3 * 255 * 255);
  const colorSimilarity = 1 - colorDiffSum / (colorCount * maxColorDiffPerPixel);

  const edgeA = edgeMagnitude(toGrayscale(a), a.width, a.height);
  const edgeB = edgeMagnitude(toGrayscale(b), b.width, b.height);
  let edgeDiffSum = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      edgeDiffSum += Math.abs(edgeA[y * a.width + x] - edgeB[y * b.width + x]);
      edgeCount++;
    }
  }
  const maxEdgeDiffPerPixel = 255 * Math.SQRT2;
  const edgeSimilarity = 1 - Math.min(1, edgeDiffSum / (edgeCount * maxEdgeDiffPerPixel));

  return colorSimilarity * 0.35 + edgeSimilarity * 0.65;
}
