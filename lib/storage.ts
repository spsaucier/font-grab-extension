import { logger } from './logger';

export const DB_NAME = 'font-grab-db';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

export interface StoredFont {
  contentHash: string;       // SHA-256 hash (primary key)
  family: string;            // "Roboto"
  subfamily: string;         // "Regular", "Bold Italic"
  format: 'woff2' | 'woff' | 'ttf' | 'otf';
  fileSize: number;          // bytes
  glyphCount: number;
  designer: string;
  manufacturer: string;
  license: string;
  isSubset: boolean;         // true = incomplete/subset font
  demoUrl?: string;          // Google Fonts or foundry URL
  sourceUrl: string;         // where it was downloaded from
  pageUrl: string;           // page where it was detected
  fontData?: Uint8Array;     // raw font binary
  timestamp: number;         // Date.now() when stored
}

export class StorageQuotaError extends Error {
  constructor(originalError: DOMException) {
    super(
      `Font storage quota exceeded. Try deleting some saved fonts to free space. ` +
      `(${originalError.message})`
    );
    this.name = 'StorageQuotaError';
  }
}

let dbInstance: IDBDatabase | null = null;

/**
 * Open (or create) the IndexedDB database.
 * Connection is cached — subsequent calls return the same instance.
 * Handles `onupgradeneeded` for schema creation.
 */
export function initDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'contentHash' });
        store.createIndex('family', 'family', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // If the connection is closed externally (e.g. browser GC), clear cache
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      // Handle version change (another tab opened a newer version)
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, mode);
  return tx.objectStore(STORE_NAME);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const error = request.error;
      if (error && error.name === 'QuotaExceededError') {
         logger.warn('Storage quota exceeded:', error.message);
        reject(new StorageQuotaError(error));
      } else {
        reject(error);
      }
    };
  });
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const error = tx.error;
      if (error && error.name === 'QuotaExceededError') {
         logger.warn('Storage quota exceeded:', error.message);
        reject(new StorageQuotaError(error));
      } else {
        reject(error);
      }
    };
    tx.onabort = () => {
      const error = tx.error;
      if (error && error.name === 'QuotaExceededError') {
         logger.warn('Storage quota exceeded:', error.message);
        reject(new StorageQuotaError(error));
      } else {
        reject(error ?? new DOMException('Transaction aborted', 'AbortError'));
      }
    };
  });
}

/** @throws {StorageQuotaError} if quota is exceeded */
export async function saveFont(font: StoredFont): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  store.put(font);
  await transactionToPromise(tx);
}

export async function getFont(contentHash: string): Promise<StoredFont | null> {
  const store = await getStore('readonly');
  const result = await requestToPromise(store.get(contentHash));
  return (result as StoredFont | undefined) ?? null;
}

/** Returns all fonts sorted by timestamp descending. */
export async function getAllFonts(): Promise<StoredFont[]> {
  const store = await getStore('readonly');
  const index = store.index('timestamp');

  return new Promise<StoredFont[]>((resolve, reject) => {
    const fonts: StoredFont[] = [];
    const request = index.openCursor(null, 'prev'); // newest first

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        fonts.push(cursor.value as StoredFont);
        cursor.continue();
      } else {
        resolve(fonts);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

export async function deleteFont(contentHash: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  store.delete(contentHash);
  await transactionToPromise(tx);
}

/** Exact match on the family index. */
export async function getFontsByFamily(family: string): Promise<StoredFont[]> {
  const store = await getStore('readonly');
  const index = store.index('family');
  const range = IDBKeyRange.only(family);
  const result = await requestToPromise(index.getAll(range));
  return result as StoredFont[];
}

export async function clearAllFonts(): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  store.clear();
  await transactionToPromise(tx);
}
