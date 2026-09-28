// Веб-сборка (docs/specs/2026-09-web.md, «Хранение»): «файлы» работ — в IndexedDB браузера,
// байтами. localStorage не годится: у него около 5 МБ на сайт и только строки, а работа
// картины 852 × 556 весит 600 КБ, в base64 — 800. Поведение — как у src/state/files.ts:
// запись целиком, прошлая версия остаётся `.bak`.
const DB = 'uzory';
const STORE = 'files';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => {
      const db = r.result;
      // другая вкладка с новой схемой просит закрыться; закрытое откроется заново
      db.onversionchange = () => db.close();
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('indexedDB: blocked'));
  }).catch((e: unknown) => {
    opening = null;
    throw e;
  });
  return opening;
}

/** Одна транзакция: `body` ставит запросы; готово, когда транзакция записана. */
async function transact(mode: IDBTransactionMode, body: (s: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('indexedDB: aborted'));
    body(t.objectStore(STORE));
  });
}

/** Свой буфер: кусок большого массива клонировался бы в базу вместе со всем массивом. */
const own = (b: Uint8Array) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b : b.slice());

export async function readFile(name: string): Promise<Uint8Array | null> {
  let out: Uint8Array | null = null;
  await transact('readonly', (s) => {
    const r = s.get(name);
    r.onsuccess = () => {
      out = r.result instanceof Uint8Array ? r.result : null;
    };
  });
  return out;
}

export async function writeFile(name: string, bytes: Uint8Array, keepBak = true): Promise<void> {
  const data = own(bytes);
  await transact('readwrite', (s) => {
    if (!keepBak) {
      s.put(data, name);
      return;
    }
    // прошлая версия и новая — в одной транзакции: сбой оставляет обе прежними
    const prev = s.get(name);
    prev.onsuccess = () => {
      if (prev.result !== undefined) s.put(prev.result, `${name}.bak`);
      s.put(data, name);
    };
  });
}

export async function removeFile(name: string): Promise<void> {
  await transact('readwrite', (s) => {
    s.delete(name);
    s.delete(`${name}.bak`);
  });
}
