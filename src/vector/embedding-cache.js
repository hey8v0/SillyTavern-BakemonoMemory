export async function getEmbeddingCacheKey(space, text) {
    const input = JSON.stringify([space, text]);
    try { if (globalThis.crypto?.subtle) {
        const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
        return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    } } catch {}
    return input;
}

export function createEmbeddingCache(options = {}) {
    const maxEntries = Math.max(1, Number(options.maxEntries || 4096));
    let indexedDB;
    try { indexedDB = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : globalThis.indexedDB; } catch {}
    let connection;
    let writes = 0;
    let unavailable = false;
    function open() {
        if (!indexedDB || unavailable) return Promise.resolve(null);
        if (!connection) connection = new Promise(resolve => {
            let settled = false;
            const finish = db => { if (!settled) { settled = true; clearTimeout(timer); resolve(db); } else db?.close(); };
            const timer = setTimeout(() => { unavailable = true; finish(null); }, 1500);
            try {
                const request = indexedDB.open('bakemono-vector-cache-v1', 1);
                request.onupgradeneeded = () => {
                    const store = request.result.createObjectStore('embeddings', { keyPath: 'key' });
                    store.createIndex('createdAt', 'createdAt');
                };
                request.onsuccess = () => {
                    request.result.onversionchange = () => { request.result.close(); unavailable = true; connection = null; };
                    finish(request.result);
                };
                request.onerror = request.onblocked = () => { unavailable = true; finish(null); };
            } catch { unavailable = true; finish(null); }
        });
        return connection;
    }
    async function transact(mode, operation) {
        const db = await open();
        if (!db) return null;
        return new Promise(resolve => {
            let result = null, settled = false, tx;
            const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
            const timer = setTimeout(() => { unavailable = true; try { tx?.abort(); } catch {} finish(null); }, 1500);
            try {
                tx = db.transaction('embeddings', mode);
                const request = operation(tx.objectStore('embeddings'));
                if (request) request.onsuccess = () => { result = request.result; };
                tx.oncomplete = () => finish(result ?? true);
                tx.onabort = tx.onerror = () => finish(null);
            } catch { finish(null); }
        });
    }
    async function get(key) {
        const result = await transact('readonly', store => store.get(key));
        const embedding = result?.embedding;
        return Array.isArray(embedding) && embedding.length && embedding.every(Number.isFinite) ? embedding : null;
    }
    async function put(key, embedding) {
        const result = await transact('readwrite', store => {
            store.put({ key, embedding, createdAt: Date.now() });
            if (++writes % 64 === 0) {
                const count = store.count();
                count.onsuccess = () => {
                    let excess = count.result - maxEntries;
                    if (excess <= 0) return;
                    const cursor = store.index('createdAt').openCursor();
                    cursor.onsuccess = () => {
                        if (cursor.result && excess-- > 0) { cursor.result.delete(); cursor.result.continue(); }
                    };
                };
            }
        });
        return result !== null;
    }
    return { get, put };
}
