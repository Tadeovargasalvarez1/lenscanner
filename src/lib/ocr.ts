import type { ScanPage } from '../types';
import { blobToCanvas } from './utils';

type OcrProgress = (progress: number, label: string) => void;

export async function recognizePages(pages: ScanPage[], language: string, onProgress: OcrProgress): Promise<string[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(language, 1, { logger: (event) => {
    if (typeof event.progress === 'number') onProgress(event.progress, event.status || 'Reconociendo');
  } });
  const results: string[] = [];
  try {
    for (let index = 0; index < pages.length; index += 1) {
      onProgress(index / pages.length, `Reconociendo página ${index + 1} de ${pages.length}`);
      const canvas = await blobToCanvas(pages[index].processed, 2200);
      const result = await worker.recognize(canvas);
      results.push(result.data.text.trim());
      onProgress((index + 1) / pages.length, `Página ${index + 1} lista`);
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
