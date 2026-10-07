import type { ScanPage } from '../types';
import { blobToCanvas } from './utils';

type OcrProgress = (progress: number, label: string) => void;

/** Grayscale + percentile autocontrast gives Tesseract cleaner input than the color preview. */
export async function prepareOcrCanvas(blob: Blob, maxDimension = 3000): Promise<HTMLCanvasElement> {
  const canvas = await blobToCanvas(blob, maxDimension);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const histogram = new Uint32Array(256);
  const luminance = new Uint8Array(data.length / 4);
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const value = (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) | 0;
    luminance[pixel] = value;
    histogram[value] += 1;
  }
  const total = luminance.length || 1;
  const lowTarget = total * 0.02;
  const highTarget = total * 0.02;
  let accumulator = 0;
  let low = 0;
  let high = 255;
  for (let value = 0; value < 256; value += 1) { accumulator += histogram[value]; if (accumulator >= lowTarget) { low = value; break; } }
  accumulator = 0;
  for (let value = 255; value >= 0; value -= 1) { accumulator += histogram[value]; if (accumulator >= highTarget) { high = value; break; } }
  const range = Math.max(1, high - low);
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    let value = (luminance[pixel] - low) * (255 / range);
    value = value < 0 ? 0 : value > 255 ? 255 : value;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export async function recognizePages(pages: ScanPage[], language: string, onProgress: OcrProgress): Promise<string[]> {
  const { createWorker, PSM } = await import('tesseract.js');
  const languages = language.split('+').map((item) => item.trim()).filter(Boolean);
  const worker = await createWorker(languages.length ? languages : ['spa'], 1, {
    logger: (event) => { if (typeof event.progress === 'number') onProgress(event.progress, event.status || 'Reconociendo'); },
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
  } catch { /* parameters are best-effort */ }

  const results: string[] = [];
  try {
    for (let index = 0; index < pages.length; index += 1) {
      onProgress(index / pages.length, `Reconociendo página ${index + 1} de ${pages.length}`);
      const canvas = await prepareOcrCanvas(pages[index].processed, 3000);
      const result = await worker.recognize(canvas);
      results.push(result.data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
      onProgress((index + 1) / pages.length, `Página ${index + 1} lista`);
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
