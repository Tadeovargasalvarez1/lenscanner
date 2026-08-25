import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteDocument, getDocument, listDocuments, saveDocument } from '../src/lib/storage';
import type { ScanDocument } from '../src/types';

const blob = new Blob(['test'], { type: 'image/jpeg' });
const documentFixture: ScanDocument = {
  id: 'test-document', name: 'Prueba', createdAt: 1, updatedAt: 2, mode: 'document',
  pages: [{ id: 'page', original: blob, processed: blob, thumbnail: blob, corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], filter: 'original', adjustments: { brightness: 0, contrast: 0, exposure: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, temperature: 0, sharpness: 0 }, rotation: 0 }],
};

describe('persistencia IndexedDB', () => {
  it('guarda, carga, lista y elimina documentos', async () => {
    await saveDocument(documentFixture);
    expect((await getDocument('test-document'))?.name).toBe('Prueba');
    expect((await listDocuments()).some((item) => item.id === 'test-document')).toBe(true);
    await deleteDocument('test-document');
    expect(await getDocument('test-document')).toBeUndefined();
  });
});
