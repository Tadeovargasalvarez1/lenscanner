import { describe, expect, it, vi } from 'vitest';
import { createPdf } from '../src/lib/pdf';
import type { ScanPage } from '../src/types';

const testJpeg = vi.hoisted(() => Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AYf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z'), (character) => character.charCodeAt(0)));
vi.mock('../src/lib/utils', () => ({
  blobToCanvas: vi.fn(async () => ({ width: 100, height: 100 })),
  canvasToBlob: vi.fn(async () => new Blob([testJpeg.buffer], { type: 'image/jpeg' })),
}));

const page: ScanPage = {
  id: 'pdf-page', original: new Blob(['original']), processed: new Blob(['processed'], { type: 'image/jpeg' }), thumbnail: new Blob(['thumb']),
  corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], filter: 'original', rotation: 0,
  adjustments: { brightness: 0, contrast: 0, exposure: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, temperature: 0, sharpness: 0 },
};

describe('exportación PDF', () => {
  it('rechaza un documento sin páginas con un error comprensible', async () => {
    await expect(createPdf([], { format: 'auto', orientation: 'auto', margin: 'small', quality: 'high' })).rejects.toThrow('Añade al menos una página');
  });

  it('acepta la configuración de exportación y devuelve un Blob PDF', async () => {
    const result = await createPdf([page], { format: 'a4', orientation: 'portrait', margin: 'small', quality: 'high' });
    expect(result.type).toBe('application/pdf');
    expect(result.size).toBeGreaterThan(500);
  });
});
