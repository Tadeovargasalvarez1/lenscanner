import type { DetectionResult, Point } from '../types';

export function orderCorners(points: Point[]): Point[] {
  if (points.length !== 4) throw new Error('Se necesitan cuatro esquinas.');
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const aroundCenter = [...points].sort((first, second) => Math.atan2(first.y - center.y, first.x - center.x) - Math.atan2(second.y - center.y, second.x - center.x));
  const topLeftIndex = aroundCenter.reduce((bestIndex, point, index) => point.x + point.y < aroundCenter[bestIndex].x + aroundCenter[bestIndex].y ? index : bestIndex, 0);
  return aroundCenter.slice(topLeftIndex).concat(aroundCenter.slice(0, topLeftIndex));
}

export function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isValidQuadrilateral(points: Point[], width: number, height: number): boolean {
  if (points.length !== 4 || width <= 0 || height <= 0) return false;
  const corners = orderCorners(points);
  const areaRatio = polygonArea(corners) / (width * height);
  if (areaRatio < 0.12 || areaRatio > 1.05) return false;
  const edges = corners.map((point, index) => distance(point, corners[(index + 1) % 4]));
  const oppositeRatio = Math.max(edges[0], edges[2]) / Math.max(1, Math.min(edges[0], edges[2]));
  const otherRatio = Math.max(edges[1], edges[3]) / Math.max(1, Math.min(edges[1], edges[3]));
  return oppositeRatio < 3.2 && otherRatio < 3.2;
}

function candidateScore(point: Point, width: number, height: number, target: 'tl' | 'tr' | 'br' | 'bl'): number {
  const x = point.x / width;
  const y = point.y / height;
  const expected = target === 'tl' ? { x: 0.2, y: 0.32 } : target === 'tr' ? { x: 0.8, y: 0.32 } : target === 'br' ? { x: 0.8, y: 0.72 } : { x: 0.2, y: 0.72 };
  const centerDistance = Math.hypot(x - expected.x, y - expected.y);
  const edgeDistance = target === 'tl' ? x + y : target === 'tr' ? (1 - x) + y : target === 'br' ? (1 - x) + (1 - y) : x + (1 - y);
  return centerDistance * 0.72 + edgeDistance * 0.28;
}

function isFluorescentOverlay(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number): boolean {
  for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
    for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
      const pixelX = x + offsetX; const pixelY = y + offsetY;
      if (pixelX < 0 || pixelY < 0 || pixelX >= width || pixelY >= height) continue;
      const at = (pixelY * width + pixelX) * 4;
      const red = pixels[at]; const green = pixels[at + 1]; const blue = pixels[at + 2];
      if (green > 165 && green - red > 42 && green - blue > 28) return true;
    }
  }
  return false;
}

/** Fast, dependency-free preview detector. It deliberately runs on a reduced canvas. */
export function detectDocumentCorners(canvas: HTMLCanvasElement): DetectionResult | null {
  const width = canvas.width;
  const height = canvas.height;
  if (width < 32 || height < 32) return null;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const pixels = context.getImageData(0, 0, width, height).data;
  const candidates: Point[] = [];
  let maxGradient = 0;
  const gradients: number[] = new Array(width * height).fill(0);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (y * width + x) * 4;
      const left = pixels[at - 4] * 0.299 + pixels[at - 3] * 0.587 + pixels[at - 2] * 0.114;
      const right = pixels[at + 4] * 0.299 + pixels[at + 5] * 0.587 + pixels[at + 6] * 0.114;
      const upAt = ((y - 1) * width + x) * 4;
      const downAt = ((y + 1) * width + x) * 4;
      const up = pixels[upAt] * 0.299 + pixels[upAt + 1] * 0.587 + pixels[upAt + 2] * 0.114;
      const down = pixels[downAt] * 0.299 + pixels[downAt + 1] * 0.587 + pixels[downAt + 2] * 0.114;
      const gradient = Math.abs(right - left) + Math.abs(down - up);
      gradients[y * width + x] = gradient;
      maxGradient = Math.max(maxGradient, gradient);
    }
  }
  const threshold = Math.max(24, maxGradient * 0.28);
  const topGuard = height * 0.12;
  const bottomGuard = height * 0.88;
  const leftGuard = width * 0.14;
  const rightGuard = width * 0.86;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      if (x > leftGuard && x < rightGuard && y > topGuard && y < bottomGuard && gradients[y * width + x] >= threshold && !isFluorescentOverlay(pixels, width, height, x, y)) candidates.push({ x, y });
    }
  }
  if (candidates.length < 8) return null;
  const pick = (target: 'tl' | 'tr' | 'br' | 'bl', used: Point[]): Point => {
    const minSeparation = Math.min(width, height) * 0.14;
    const region = candidates.filter((point) => {
      const left = point.x < width * 0.5; const top = point.y < height * 0.5;
      return target === 'tl' ? left && top : target === 'tr' ? !left && top : target === 'br' ? !left && !top : left && !top;
    });
    const regional = region.length ? region : candidates;
    const available = regional.filter((point) => used.every((other) => distance(point, other) > minSeparation));
    const pool = available.length ? available : regional;
    return pool.reduce((best, point) => candidateScore(point, width, height, target) < candidateScore(best, width, height, target) ? point : best);
  };
  const chosen: Point[] = [];
  (['tl', 'tr', 'br', 'bl'] as const).forEach((target) => chosen.push(pick(target, chosen)));
  const corners = orderCorners(chosen);
  if (!isValidQuadrilateral(corners, width, height)) return null;
  const areaConfidence = Math.min(1, polygonArea(corners) / (width * height));
  return { corners, confidence: Math.round(areaConfidence * 100) / 100, message: areaConfidence > 0.35 ? 'Listo' : 'Acércate' };
}

export function rotatePoints(points: Point[], quarterTurns: number, width: number, height: number): Point[] {
  const turns = ((quarterTurns % 4) + 4) % 4;
  return points.map((point) => {
    if (turns === 1) return { x: height - point.y, y: point.x };
    if (turns === 2) return { x: width - point.x, y: height - point.y };
    if (turns === 3) return { x: point.y, y: width - point.x };
    return { ...point };
  });
}
