"use strict";

// 문제 데이터와 PDF 원본은 크기가 커서 IndexedDB에 둔다. 이 기기 브라우저에만 저장된다.
(function () {
  const DB_NAME = "cppg-master";
  const STORE = "kv";
  let dbPromise = null;

  function open() {
    dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }

  window.KV = {
    get: (key) => tx("readonly", (s) => s.get(key)),
    set: (key, value) => tx("readwrite", (s) => s.put(value, key)),
    del: (key) => tx("readwrite", (s) => s.delete(key)),
  };
})();
