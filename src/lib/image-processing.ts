import type { Adjustments, FilterName, Point } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';
import { blobToCanvas, canvasToBlob, clamp } from './utils';
import { orderCorners } from './geometry';

interface Homography { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; }

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column] || 1e-9;
    for (let cell = column; cell <= size; cell += 1) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell <= size; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
    }
  }
  return augmented.map((row) => row[size]);
}

function homographyFromCorners(source: Point[], outputWidth: number, outputHeight: number): Homography {
  const destination = [{ x: 0, y: 0 }, { x: outputWidth, y: 0 }, { x: outputWidth, y: outputHeight }, { x: 0, y: outputHeight }];
  const matrix: number[][] = [];
  const vector: number[] = [];
  source.forEach((point, index) => {
    const target = destination[index];
    matrix.push([point.x, point.y, 1, 0, 0, 0, -target.x * point.x, -target.x * point.y]);
    vector.push(target.x);
    matrix.push([0, 0, 0, point.x, point.y, 1, -target.y * point.x, -target.y * point.y]);
    vector.push(target.y);
  });
  const [a, b, c, d, e, f, g, h] = solveLinear(matrix, vector);
  return { a, b, c, d, e, f, g, h };
}

function mapSourceToDestination(point: Point, homography: Homography): Point {
  const denominator = homography.g * point.x + homography.h * point.y + 1;
  return {
    x: (homography.a * point.x + homography.b * point.y + homography.c) / denominator,
    y: (homography.d * point.x + homography.e * point.y + homography.f) / denominator,
  };
}

function bilinearSample(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): [number, number, number] {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const xf = x - x0;
  const yf = y - y0;
  const index = (px: number, py: number) => (py * width + px) * 4;
  const p00 = index(x0, y0); const p10 = index(x1, y0); const p01 = index(x0, y1); const p11 = index(x1, y1);
  return [0, 1, 2].map((channel) => {
    const top = data[p00 + channel] * (1 - xf) + data[p10 + channel] * xf;
    const bottom = data[p01 + channel] * (1 - xf) + data[p11 + channel] * xf;
    return top * (1 - yf) + bottom * yf;
  }) as [number, number, number];
}

/** Perspective correction using an inverse projective map and bilinear sampling. */
export function warpPerspective(sourceCanvas: HTMLCanvasElement, corners: Point[], maxDimension = 2600): HTMLCanvasElement {
  const ordered = orderCorners(corners);
  const top = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const bottom = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
  const left = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  const right = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
  const ratio = Math.max(0.35, Math.min(3.2, (top + bottom) / Math.max(1, left + right)));
  const longEdge = Math.min(maxDimension, Math.max(top, bottom, left, right));
  let width = ratio >= 1 ? Math.round(longEdge) : Math.round(longEdge * ratio);
  let height = ratio >= 1 ? Math.round(longEdge / ratio) : Math.round(longEdge);
  if (width < 40 || height < 40) { width = Math.max(40, Math.round(top)); height = Math.max(40, Math.round(left)); }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(40, Math.round(width * scale));
  height = Math.max(40, Math.round(height * scale));
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('No se pudo leer la fotografía.');
  const sourcePixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const output = document.createElement('canvas');
  output.width = width; output.height = height;
  const outputContext = output.getContext('2d', { willReadFrequently: true })!;
  const outputPixels = outputContext.createImageData(width, height);
  const destinationToSource = homographyFromCorners(ordered, width, height);
  // Solve destination -> source by using the four destination points as source in a second mapping.
  const sourceToDestination = homographyFromCorners([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], sourceCanvas.width, sourceCanvas.height);
  void destinationToSource;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = mapSourceToDestination({ x, y }, sourceToDestination);
      const [r, g, b] = bilinearSample(sourcePixels.data, sourceCanvas.width, sourceCanvas.height, source.x, source.y);
      const at = (y * width + x) * 4;
      outputPixels.data[at] = r; outputPixels.data[at + 1] = g; outputPixels.data[at + 2] = b; outputPixels.data[at + 3] = 255;
    }
  }
  outputContext.putImageData(outputPixels, 0, 0);
  return output;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6; if (h < 0) h += 1;
  }
  const l = (max + min) / 2;
  return [h, max === min ? 0 : delta / (1 - Math.abs(2 * l - 1)), l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(hue(n) - 3, Math.min(9 - hue(n), 1)));
  return [channel(0) * 255, channel(8) * 255, channel(4) * 255];
}

function makeIlluminationMap(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gridWidth = 32; const gridHeight = 32;
  const grid = new Uint8Array(gridWidth * gridHeight);
  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const x = Math.min(width - 1, Math.round((gx / (gridWidth - 1)) * (width - 1)));
      const y = Math.min(height - 1, Math.round((gy / (gridHeight - 1)) * (height - 1)));
      let total = 0; let count = 0;
      for (let oy = -2; oy <= 2; oy += 1) for (let ox = -2; ox <= 2; ox += 1) {
        const sx = Math.min(width - 1, Math.max(0, x + ox)); const sy = Math.min(height - 1, Math.max(0, y + oy));
        const at = (sy * width + sx) * 4;
        total += data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114; count += 1;
      }
      grid[gy * gridWidth + gx] = Math.round(total / count);
    }
  }
  return grid;
}

function localLight(grid: Uint8Array, x: number, y: number, width: number, height: number): number {
  const gx = (x / Math.max(1, width - 1)) * 31; const gy = (y / Math.max(1, height - 1)) * 31;
  const x0 = Math.floor(gx); const y0 = Math.floor(gy); const x1 = Math.min(31, x0 + 1); const y1 = Math.min(31, y0 + 1);
  const xf = gx - x0; const yf = gy - y0;
  const a = grid[y0 * 32 + x0] * (1 - xf) + grid[y0 * 32 + x1] * xf;
  const b = grid[y1 * 32 + x0] * (1 - xf) + grid[y1 * 32 + x1] * xf;
  return a * (1 - yf) + b * yf;
}

function applyAdjustments(canvas: HTMLCanvasElement, filter: FilterName, adjustments: Adjustments): HTMLCanvasElement {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No se pudo procesar la página.');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const illumination = makeIlluminationMap(data, canvas.width, canvas.height);
  const isGray = filter === 'gray' || filter === 'bw' || filter === 'document' || filter === 'receipt' || filter === 'board';
  const isStrongDocument = filter === 'document' || filter === 'bw' || filter === 'receipt';
  const contrast = 1 + (adjustments.contrast / 100) + (filter === 'enhanced' ? 0.16 : 0) + (filter === 'board' ? 0.28 : 0);
  const exposure = 2 ** ((adjustments.exposure + (filter === 'enhanced' ? 0.12 : 0)) / 2);
  const brightness = adjustments.brightness * 2.55;
  const saturation = 1 + (adjustments.saturation / 100) + (filter === 'vivid' ? 0.34 : 0);
  const sharpness = Math.max(0, adjustments.sharpness + (filter === 'document' || filter === 'receipt' ? 0.18 : 0));
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const at = (y * canvas.width + x) * 4;
      let r = data[at]; let g = data[at + 1]; let b = data[at + 2];
      const light = localLight(illumination, x, y, canvas.width, canvas.height);
      if (isStrongDocument) {
        const normalization = clamp(175 / Math.max(70, light), 0.72, 1.55);
        r *= normalization; g *= normalization; b *= normalization;
      }
      r = (r - 128) * contrast + 128 + brightness;
      g = (g - 128) * contrast + 128 + brightness;
      b = (b - 128) * contrast + 128 + brightness;
      r *= exposure; g *= exposure; b *= exposure;
      const [h, s, l] = rgbToHsl(clamp(r / 255) * 255, clamp(g / 255) * 255, clamp(b / 255) * 255);
      [r, g, b] = hslToRgb(h + adjustments.temperature / 1800, clamp(s * saturation), clamp(l + adjustments.whites / 800 - adjustments.blacks / 800));
      if (isGray) { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = gray; g = gray; b = gray; }
      if (filter === 'bw' || filter === 'receipt') {
        const luminance = r * 0.299 + g * 0.587 + b * 0.114;
        const localThreshold = 135 + (light - 128) * 0.22;
        const binary = luminance > localThreshold ? 255 : 18;
        r = binary; g = binary; b = binary;
      }
      if (filter === 'board') {
        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        const boosted = gray < 70 ? gray * 0.45 : Math.min(255, gray * 1.25);
        r = boosted; g = boosted; b = boosted;
      }
      const sharpen = sharpness * 0.3;
      data[at] = clamp((r + (r - light) * sharpen) / 255) * 255;
      data[at + 1] = clamp((g + (g - light) * sharpen) / 255) * 255;
      data[at + 2] = clamp((b + (b - light) * sharpen) / 255) * 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export async function processDocument(blob: Blob, corners: Point[], filter: FilterName, adjustments: Adjustments = DEFAULT_ADJUSTMENTS): Promise<{ processed: Blob; thumbnail: Blob }> {
  const source = await blobToCanvas(blob, 2600);
  const warped = warpPerspective(source, corners, 2400);
  const processedCanvas = filter === 'original' ? warped : applyAdjustments(warped, filter, adjustments);
  const processed = await canvasToBlob(processedCanvas, 'image/jpeg', filter === 'bw' ? 0.94 : 0.9);
  const thumbnailCanvas = await blobToCanvas(processed, 560);
  const thumbnail = await canvasToBlob(thumbnailCanvas, 'image/jpeg', 0.78);
  return { processed, thumbnail };
}

export async function rotateBlob(blob: Blob, quarterTurns = 1): Promise<Blob> {
  const source = await blobToCanvas(blob);
  const output = document.createElement('canvas');
  const turns = ((quarterTurns % 4) + 4) % 4;
  output.width = turns % 2 ? source.height : source.width;
  output.height = turns % 2 ? source.width : source.height;
  const context = output.getContext('2d')!;
  context.translate(output.width / 2, output.height / 2);
  context.rotate(turns * Math.PI / 2);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvasToBlob(output, 'image/jpeg', 0.9);
}

export async function estimateSharpness(blob: Blob): Promise<number> {
  const canvas = await blobToCanvas(blob, 640);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const values: number[] = [];
  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const gray = (px: number, py: number) => { const at = (py * canvas.width + px) * 4; return data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114; };
      const laplacian = gray(x - 1, y) + gray(x + 1, y) + gray(x, y - 1) + gray(x, y + 1) - gray(x, y) * 4;
      values.push(laplacian);
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
}
