import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { PdfOptions, ScanPage } from '../types';
import { blobToCanvas, canvasToBlob } from './utils';

const SIZES: Record<Exclude<PdfOptions['format'], 'auto'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

export async function createPdf(pages: ScanPage[], options: PdfOptions, watermark = ''): Promise<Blob> {
  if (!pages.length) throw new Error('Añade al menos una página para crear el PDF.');
  const pdf = await PDFDocument.create();
  for (const page of pages) {
    const canvas = await blobToCanvas(page.processed, 3000);
    const imageBlob = await canvasToBlob(canvas, 'image/jpeg', options.quality === 'small' ? 0.68 : options.quality === 'balanced' ? 0.82 : 0.92);
    const image = await pdf.embedJpg(await imageBlob.arrayBuffer());
    const imageRatio = canvas.width / canvas.height;
    let width: number; let height: number;
    if (options.format === 'auto') { height = 780; width = height * imageRatio; }
    else {
      let [pageWidth, pageHeight] = SIZES[options.format];
      const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && imageRatio > 1);
      if (landscape) [pageWidth, pageHeight] = [pageHeight, pageWidth];
      width = pageWidth; height = pageHeight;
    }
    const pdfPage = pdf.addPage([width, height]);
    const margin = options.margin === 'none' ? 0 : options.margin === 'small' ? 14 : 28;
    const availableWidth = width - margin * 2; const availableHeight = height - margin * 2;
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
    const drawWidth = image.width * scale; const drawHeight = image.height * scale;
    const x = (width - drawWidth) / 2; const y = (height - drawHeight) / 2;
    pdfPage.drawImage(image, { x, y, width: drawWidth, height: drawHeight, rotate: degrees(page.rotation) });
    if (watermark.trim()) pdfPage.drawText(watermark.trim().slice(0, 120), { x: margin, y: 10, size: 8, color: rgb(0.35, 0.35, 0.35), opacity: 0.6 });
  }
  const bytes = await pdf.save();
  const safeBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(safeBuffer).set(bytes);
  return new Blob([safeBuffer], { type: 'application/pdf' });
}
