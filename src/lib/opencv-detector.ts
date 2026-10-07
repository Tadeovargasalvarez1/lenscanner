import type { DetectionResult, Point } from '../types';
import { distance, orderCorners, polygonArea } from './geometry';

type OpenCv = any;
let cvPromise: Promise<OpenCv> | null = null;

async function loadOpenCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then(async (module) => {
      const candidate = (module as { default?: OpenCv }).default ?? module;
      if (candidate?.Mat) return candidate;
      if (candidate instanceof Promise) return candidate;
      return new Promise<OpenCv>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('OpenCV tardó demasiado en inicializarse.')), 12000);
        candidate.onRuntimeInitialized = () => { window.clearTimeout(timeout); resolve(candidate); };
      });
    }).catch((error) => { cvPromise = null; throw error; });
  }
  return cvPromise;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

function pointAngle(a: Point, b: Point, c: Point): number {
  const first = { x: a.x - b.x, y: a.y - b.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y) || 1;
  return Math.abs((first.x * second.x + first.y * second.y) / denominator);
}

interface Quad { corners: Point[]; score: number; }

/** Validate a 4-point candidate and give it a quality score. */
function toQuad(raw: Point[], width: number, height: number): Quad | null {
  if (!raw || raw.length !== 4) return null;
  const corners = orderCorners(raw);
  const area = polygonArea(corners);
  const areaRatio = area / (width * height);
  if (areaRatio < 0.03 || areaRatio > 1.02) return null;

  const sides = corners.map((point, index) => distance(point, corners[(index + 1) % 4]));
  const width1 = (sides[0] + sides[2]) / 2;
  const height1 = (sides[1] + sides[3]) / 2;
  if (width1 < 8 || height1 < 8) return null;

  const rectangularity = clamp01(area / Math.max(1, width1 * height1));
  if (rectangularity < 0.6) return null;

  const aspect = Math.max(width1, height1) / Math.max(1, Math.min(width1, height1));
  if (aspect > 5) return null;

  const angleQuality = clamp01(1 - corners.reduce((sum, _point, index) => sum + pointAngle(corners[(index + 3) % 4], corners[index], corners[(index + 1) % 4]), 0) / 4);
  const touchesEdge = corners.filter((point) => point.x <= 1 || point.y <= 1 || point.x >= width - 1 || point.y >= height - 1).length;
  const edgePenalty = touchesEdge >= 3 ? 0.18 : touchesEdge === 2 ? 0.06 : 0;

  const score = areaRatio * 0.5 + rectangularity * 0.2 + angleQuality * 0.3 - edgePenalty;
  if (score <= 0) return null;
  return { corners, score };
}

function matPointsToCorners(approx: OpenCv): Point[] | null {
  if (!approx || approx.rows !== 4 || !approx.data32S || approx.data32S.length < 8) return null;
  const points: Point[] = [];
  for (let index = 0; index < 8; index += 2) points.push({ x: approx.data32S[index], y: approx.data32S[index + 1] });
  return points;
}

const EPSILON_STEPS = [0.015, 0.022, 0.03, 0.04, 0.052, 0.065, 0.08, 0.1, 0.13, 0.17, 0.22];

function bestQuadFromMask(cv: OpenCv, mask: OpenCv, width: number, height: number): Quad | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best: Quad | null = null;
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      try {
        const area = Math.abs(cv.contourArea(contour));
        const areaRatio = area / (width * height);
        if (areaRatio < 0.03 || areaRatio > 1.02) continue;
        const perimeter = cv.arcLength(contour, true);
        if (perimeter <= 0) continue;

        let quad: Quad | null = null;
        for (const step of EPSILON_STEPS) {
          const approx = new cv.Mat();
          cv.approxPolyDP(contour, approx, Math.max(2, perimeter * step), true);
          if (approx.rows === 4) {
            const points = matPointsToCorners(approx);
            if (points) { const candidate = toQuad(points, width, height); if (candidate && (!quad || candidate.score > quad.score)) quad = candidate; }
          }
          approx.delete();
        }

        if (!quad && cv.RotatedRect && cv.RotatedRect.points) {
          try {
            const rect = cv.minAreaRect(contour);
            const points = cv.RotatedRect.points(rect) as Point[];
            const candidate = toQuad(points, width, height);
            if (candidate) quad = candidate;
          } catch { /* ignore minAreaRect failures */ }
        }

        if (quad && (!best || quad.score > best.score)) best = quad;
      } finally {
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return best;
}

function better(a: Quad | null, b: Quad | null): Quad | null {
  if (!a) return b;
  if (!b) return a;
  return b.score > a.score ? b : a;
}

/** OpenCV contour detector. Multi-strategy: Canny, adaptive threshold and Otsu, plus minAreaRect fallback. */
export async function detectDocumentCornersOpenCv(canvas: HTMLCanvasElement): Promise<DetectionResult | null> {
  try {
    const cv = await loadOpenCv();
    const width = canvas.width;
    const height = canvas.height;
    const source = cv.imread(canvas);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const closed = new cv.Mat();
    const adaptive = new cv.Mat();
    const closedAdaptive = new cv.Mat();
    const otsu = new cv.Mat();
    const closedOtsu = new cv.Mat();
    const kernel7 = cv.Mat.ones(7, 7, cv.CV_8U);
    const kernel5 = cv.Mat.ones(5, 5, cv.CV_8U);
    let best: Quad | null = null;
    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

      cv.Canny(blurred, edges, 40, 120, 3, false);
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel7);
      best = better(best, bestQuadFromMask(cv, closed, width, height));

      const blockSize = Math.max(15, (Math.floor(Math.min(width, height) / 24) | 1));
      cv.adaptiveThreshold(blurred, adaptive, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, blockSize, 12);
      cv.morphologyEx(adaptive, closedAdaptive, cv.MORPH_CLOSE, kernel5);
      best = better(best, bestQuadFromMask(cv, closedAdaptive, width, height));

      cv.threshold(blurred, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(otsu, closedOtsu, cv.MORPH_CLOSE, kernel5);
      best = better(best, bestQuadFromMask(cv, closedOtsu, width, height));
    } finally {
      source.delete(); gray.delete(); blurred.delete(); edges.delete(); closed.delete();
      adaptive.delete(); closedAdaptive.delete(); otsu.delete(); closedOtsu.delete();
      kernel7.delete(); kernel5.delete();
    }
    if (!best) return null;
    const confidence = Math.round(clamp01(Math.max(0.4, best.score)) * 100) / 100;
    return { corners: best.corners, confidence, message: confidence > 0.62 ? 'Listo' : 'Mantén firme' };
  } catch (error) {
    console.warn('OpenCV document detection unavailable; using the local fallback.', error);
    return null;
  }
}
