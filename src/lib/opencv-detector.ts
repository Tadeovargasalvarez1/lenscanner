import type { DetectionResult, Point } from '../types';
import { orderCorners, polygonArea } from './geometry';

type OpenCv = any;
let cvPromise: Promise<OpenCv> | null = null;

async function loadOpenCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then(async (module) => {
      const candidate = (module as { default?: OpenCv }).default ?? module;
      if (candidate?.Mat) return candidate;
      if (candidate instanceof Promise) return candidate;
      return new Promise<OpenCv>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('OpenCV tardó demasiado en inicializarse.')), 9000);
        candidate.onRuntimeInitialized = () => { window.clearTimeout(timeout); resolve(candidate); };
      });
    }).catch((error) => { cvPromise = null; throw error; });
  }
  return cvPromise;
}

function pointAngle(a: Point, b: Point, c: Point): number {
  const first = { x: a.x - b.x, y: a.y - b.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y) || 1;
  return Math.abs((first.x * second.x + first.y * second.y) / denominator);
}

function quadrilateralQuality(points: Point[], width: number, height: number): number {
  const corners = orderCorners(points);
  const angleQuality = 1 - corners.reduce((sum, _, index) => sum + pointAngle(corners[(index + 3) % 4], corners[index], corners[(index + 1) % 4]), 0) / 4;
  const areaRatio = polygonArea(corners) / (width * height);
  const borderDistance = Math.min(...corners.map((point) => Math.min(point.x, point.y, width - point.x, height - point.y))) / Math.min(width, height);
  const borderQuality = Math.min(1, borderDistance * 8);
  return Math.max(0, Math.min(1, angleQuality * 0.58 + Math.min(1, areaRatio * 2) * 0.28 + borderQuality * 0.14));
}

function matPointsToCorners(approx: OpenCv, width: number, height: number): Point[] | null {
  if (!approx || approx.rows !== 4 || !approx.data32S || approx.data32S.length < 8) return null;
  const points: Point[] = [];
  for (let index = 0; index < 8; index += 2) points.push({ x: approx.data32S[index], y: approx.data32S[index + 1] });
  const corners = orderCorners(points);
  const areaRatio = polygonArea(corners) / (width * height);
  return areaRatio >= 0.015 && areaRatio <= 1.05 ? corners : null;
}

function neonEdgeScore(canvas: HTMLCanvasElement, corners: Point[]): number {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let samples = 0;
  let neonSamples = 0;
  const samplePixel = (x: number, y: number): void => {
    const pixelX = Math.round(x);
    const pixelY = Math.round(y);
    if (pixelX < 0 || pixelY < 0 || pixelX >= canvas.width || pixelY >= canvas.height) return;
    const offset = (pixelY * canvas.width + pixelX) * 4;
    const red = pixels[offset]; const green = pixels[offset + 1]; const blue = pixels[offset + 2];
    samples += 1;
    if (green > 165 && green - red > 42 && green - blue > 28) neonSamples += 1;
  };
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index]; const end = corners[(index + 1) % corners.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(8, Math.ceil(length / 3));
    const normal = { x: -(end.y - start.y) / Math.max(1, length), y: (end.x - start.x) / Math.max(1, length) };
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      const x = start.x + (end.x - start.x) * ratio;
      const y = start.y + (end.y - start.y) * ratio;
      for (let offset = -3; offset <= 3; offset += 1) samplePixel(x + normal.x * offset, y + normal.y * offset);
    }
  }
  return samples ? neonSamples / samples : 0;
}

/** OpenCV contour detector. It runs only on the reduced preview, never on the full photo. */
export async function detectDocumentCornersOpenCv(canvas: HTMLCanvasElement): Promise<DetectionResult | null> {
  try {
    const cv = await loadOpenCv();
    const width = canvas.width; const height = canvas.height;
    const source = cv.imread(canvas); const gray = new cv.Mat(); const blurred = new cv.Mat(); const edges = new cv.Mat();
    const closed = new cv.Mat(); const contours = new cv.MatVector(); const hierarchy = new cv.Mat();
    let best: { corners: Point[]; score: number; area: number } | null = null;
    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blurred, edges, 32, 115, 3, false);
      const kernel = cv.Mat.ones(9, 9, cv.CV_8U);
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
      kernel.delete();
      cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let index = 0; index < contours.size(); index += 1) {
        const contour = contours.get(index);
        const perimeter = cv.arcLength(contour, true);
        if (perimeter < Math.min(width, height) * 0.9) { contour.delete(); continue; }
        const area = Math.abs(cv.contourArea(contour));
        const areaRatio = area / (width * height);
        if (areaRatio < 0.035 || areaRatio > 0.96) { contour.delete(); continue; }
        let corners: Point[] | null = null;
        for (const epsilonRatio of [0.018, 0.028, 0.04, 0.055, 0.075, 0.1, 0.14, 0.18]) {
          const approx = new cv.Mat();
          cv.approxPolyDP(contour, approx, Math.max(2, perimeter * epsilonRatio), true);
          corners = matPointsToCorners(approx, width, height);
          approx.delete();
          if (corners) break;
        }
        if (corners) {
          const touchesPreviewEdge = corners.some((point) => point.x <= 2 || point.y <= 2 || point.x >= width - 2 || point.y >= height - 2);
          if (touchesPreviewEdge) { contour.delete(); continue; }
          const quality = quadrilateralQuality(corners, width, height);
          const neonPenalty = neonEdgeScore(canvas, corners);
          const score = areaRatio * 0.58 + quality * 0.32 - neonPenalty * 0.7;
          if (!best || score > best.score) best = { corners, score, area };
        }
        contour.delete();
      }
    } finally {
      source.delete(); gray.delete(); blurred.delete(); edges.delete(); closed.delete(); contours.delete(); hierarchy.delete();
    }
    if (!best) return null;
    const confidence = Math.round(Math.min(0.99, Math.max(0.35, best.score)) * 100) / 100;
    return { corners: best.corners, confidence, message: confidence > 0.55 ? 'Listo' : 'Mantén firme' };
  } catch (error) {
    console.warn('OpenCV document detection unavailable; using the local fallback.', error);
    return null;
  }
}
