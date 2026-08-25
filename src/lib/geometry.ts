import type { DetectionResult, Point } from '../types';

export function orderCorners(points: Point[]): Point[] {
  if (points.length !== 4) throw new Error('Se necesitan cuatro esquinas.');
  const sums = points.map((point) => point.x + point.y);
  const diffs = points.map((point) => point.x - point.y);
  const topLeft = points[sums.indexOf(Math.min(...sums))];
  const bottomRight = points[sums.indexOf(Math.max(...sums))];
  const topRight = points[diffs.indexOf(Math.max(...diffs))];
  const bottomLeft = points[diffs.indexOf(Math.min(...diffs))];
  return [topLeft, topRight, bottomRight, bottomLeft];
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
  if (target === 'tl') return x + y;
  if (target === 'tr') return (1 - x) + y;
  if (target === 'br') return (1 - x) + (1 - y);
  return x + (1 - y);
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
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      if (gradients[y * width + x] >= threshold) candidates.push({ x, y });
    }
  }
  if (candidates.length < 8) return null;
  const pick = (target: 'tl' | 'tr' | 'br' | 'bl', used: Point[]): Point => {
    const minSeparation = Math.min(width, height) * 0.14;
    const available = candidates.filter((point) => used.every((other) => distance(point, other) > minSeparation));
    const pool = available.length ? available : candidates;
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
