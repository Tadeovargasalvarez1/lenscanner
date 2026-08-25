import type { ScanDocument } from '../types';

const DB_NAME = 'folio-local';
const DB_VERSION = 1;
const STORE = 'documents';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo acceder al almacenamiento local.'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) throw new Error('Este navegador no permite almacenamiento local.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo iniciar el almacenamiento local.'));
  });
}

export async function saveDocument(document: ScanDocument): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).put(document);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el documento.'));
  });
  db.close();
}

export async function listDocuments(): Promise<ScanDocument[]> {
  const db = await openDatabase();
  const documents = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  db.close();
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id: string): Promise<ScanDocument | undefined> {
  const db = await openDatabase();
  const document = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
  db.close();
  return document;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo eliminar el documento.'));
  });
  db.close();
}

export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0 };
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}
