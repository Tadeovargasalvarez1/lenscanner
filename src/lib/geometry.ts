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

function cornerExtremity(point: Point, width: number, height: number, target: 'tl' | 'tr' | 'br' | 'bl'): number {
  if (target === 'tl') return point.x + point.y;
  if (target === 'tr') return (width - point.x) + point.y;
  if (target === 'br') return (width - point.x) + (height - point.y);
  return point.x + (height - point.y);
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
  const gradients = new Float32Array(width * height);
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
      if (gradient > maxGradient) maxGradient = gradient;
    }
  }
  const threshold = Math.max(26, maxGradient * 0.3);
  const marginX = Math.max(2, width * 0.03);
  const marginY = Math.max(2, height * 0.03);
  for (let y = marginY; y < height - marginY; y += 2) {
    for (let x = marginX; x < width - marginX; x += 2) {
      const at = y * width + x;
      if (gradients[at] >= threshold && !isFluorescentOverlay(pixels, width, height, x, y)) candidates.push({ x, y });
    }
  }
  if (candidates.length < 6) return null;
  const pick = (target: 'tl' | 'tr' | 'br' | 'bl', used: Point[]): Point => {
    const minSeparation = Math.min(width, height) * 0.18;
    const halfX = width * 0.5; const halfY = height * 0.5;
    const regional = candidates.filter((point) => {
      const left = point.x < halfX; const top = point.y < halfY;
      return target === 'tl' ? left && top : target === 'tr' ? !left && top : target === 'br' ? !left && !top : left && !top;
    });
    const pool = regional.length ? regional : candidates;
    const separated = pool.filter((point) => used.every((other) => distance(point, other) > minSeparation));
    const finalPool = separated.length ? separated : pool;
    return finalPool.reduce((best, point) => cornerExtremity(point, width, height, target) < cornerExtremity(best, width, height, target) ? point : best);
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
