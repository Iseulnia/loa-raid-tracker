// 화면공유로 받은 라이브 프레임과 저장된 기준 이미지(템플릿)를 비교하는 가벼운 클라이언트 사이드 이미지 매칭.
// 무거운 CV 라이브러리 없이 Canvas만으로 "정규화된 픽셀 유사도"를 계산한다.
// 게임 UI는 사진이 아니라 렌더링된 화면이라 이 정도로도 꽤 잘 구분된다.

export type CropPct = { xPct: number; yPct: number; wPct: number; hPct: number };

const SAMPLE_WIDTH = 96;

function sampleHeightFor(crop: CropPct): number {
  const ratio = crop.hPct / crop.wPct;
  return Math.max(16, Math.min(160, Math.round(SAMPLE_WIDTH * ratio)));
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

/** 0(완전히 다름) ~ 1(동일) 사이의 유사도. RGB 유클리드 거리를 정규화한 값. */
export function similarity(a: ImageData, b: ImageData): number {
  const d1 = a.data;
  const d2 = b.data;
  const len = Math.min(d1.length, d2.length);
  let diffSum = 0;
  let count = 0;
  for (let i = 0; i < len; i += 4) {
    const dr = d1[i] - d2[i];
    const dg = d1[i + 1] - d2[i + 1];
    const db = d1[i + 2] - d2[i + 2];
    diffSum += Math.sqrt(dr * dr + dg * dg + db * db);
    count++;
  }
  const maxDiffPerPixel = Math.sqrt(3 * 255 * 255);
  return 1 - diffSum / (count * maxDiffPerPixel);
}
