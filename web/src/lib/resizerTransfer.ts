export type ResizerTransferItem = {
  name: string;
  blob: Blob;
  width: number;
  height: number;
};

type ResizerTransferRecord = {
  id: string;
  type: 'creative-resizer-to-asset-renamer';
  createdAt: number;
  items: ResizerTransferItem[];
};

const DB_NAME = 'number-cruncher-transfer-db';
const STORE_NAME = 'payloads';
const RECORD_TTL_MS = 1000 * 60 * 60 * 24; // 24h

const toRequestPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });

const toTransactionPromise = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });

const openTransferDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });

const cleanupExpiredRecords = async (db: IDBDatabase) => {
  const now = Date.now();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const records = await toRequestPromise(store.getAll() as IDBRequest<ResizerTransferRecord[]>);
  records.forEach((record) => {
    if (now - record.createdAt > RECORD_TTL_MS) {
      store.delete(record.id);
    }
  });
  await toTransactionPromise(tx);
};

export const storeResizerTransfer = async (items: ResizerTransferItem[]) => {
  const db = await openTransferDb();
  try {
    await cleanupExpiredRecords(db);
    const id = `rsz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: ResizerTransferRecord = {
      id,
      type: 'creative-resizer-to-asset-renamer',
      createdAt: Date.now(),
      items,
    };
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    await toTransactionPromise(tx);
    return id;
  } finally {
    db.close();
  }
};

export const getResizerTransfer = async (id: string): Promise<ResizerTransferItem[] | null> => {
  const db = await openTransferDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const record = await toRequestPromise(
      store.get(id) as IDBRequest<ResizerTransferRecord | undefined>,
    );
    await toTransactionPromise(tx);
    if (!record || record.type !== 'creative-resizer-to-asset-renamer') {
      return null;
    }
    return record.items;
  } finally {
    db.close();
  }
};

export const deleteResizerTransfer = async (id: string) => {
  const db = await openTransferDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await toTransactionPromise(tx);
  } finally {
    db.close();
  }
};
