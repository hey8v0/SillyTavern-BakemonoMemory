// The vector index lives in its own file on the tavern server (SillyTavern's user files), not in the chat file.
// A chat file is rewritten on every message, so thousands of embeddings inside it made every save upload megabytes;
// the index file is written only when the index itself changes. The chat keeps a pointer: { path, signature, count }.
import { encodeEmbedding, decodeEmbedding, vectorRecordsSignature as signatureOf } from './storage.js';

export const vectorRecordsSignature = records => signatureOf(records);

// SillyTavern accepts only letters, digits, '_', '-' and '.' in upload names.
export function vectorSidecarName(chatKey, getHash) {
    const key = String(chatKey || 'chat');
    return `bakemono-vectors-${getHash(key)}${getHash([...key].reverse().join(''))}.json`;
}

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
}

export function createVectorSidecar({ fetchImpl = (...args) => fetch(...args), getHeaders = () => ({}), getChatKey = () => '', getHash, warn = () => {} } = {}) {
    const loading = new WeakMap();

    async function save(vectorMemory) {
        const records = vectorMemory?.records || [];
        if (!records.length) return null;
        const signature = vectorRecordsSignature(records);
        if (vectorMemory.sidecar?.signature === signature) return vectorMemory.sidecar;
        const payload = JSON.stringify({ format: 'bakemono-vectors', version: 1, signature,
            records: records.map(record => ({ ...record, embedding: typeof record.embedding === 'string' ? record.embedding : encodeEmbedding(record.embedding) })) });
        const response = await fetchImpl('/api/files/upload', { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: vectorSidecarName(getChatKey(), getHash), data: toBase64(payload) }) });
        if (!response.ok) throw new Error(`向量索引文件没有写入（${response.status}）`);
        const { path } = await response.json();
        if (!path) throw new Error('向量索引文件没有返回位置');
        // Only now the chat file may drop the records: the file holds exactly these.
        if (vectorRecordsSignature(vectorMemory.records) !== signature) return null;
        vectorMemory.sidecar = { path: String(path), signature, count: records.length, savedAt: new Date().toISOString() };
        return vectorMemory.sidecar;
    }

    // Fills vectorMemory.records from the file when the chat was saved without them. Resolves to true when loaded.
    function load(vectorMemory) {
        const pointer = vectorMemory?.sidecar;
        if (!pointer?.path || vectorMemory.records?.length) return Promise.resolve(false);
        if (loading.has(vectorMemory)) return loading.get(vectorMemory);
        const run = (async () => {
            try {
                const url = '/' + String(pointer.path).replace(/\\/g, '/').replace(/^\/+/, '') + '?v=' + encodeURIComponent(pointer.signature);
                const response = await fetchImpl(url, { cache: 'no-store' });
                if (!response.ok) throw new Error(`向量索引文件读取失败（${response.status}）`);
                const payload = await response.json();
                if (payload?.format !== 'bakemono-vectors' || payload.signature !== pointer.signature || !Array.isArray(payload.records)) throw new Error('向量索引文件与聊天记录不一致');
                if (vectorMemory.records?.length) return false;
                vectorMemory.records = payload.records.map(record => ({ ...record, embedding: decodeEmbedding(record.embedding) }));
                return true;
            } catch (error) {
                warn('[BakemonoMemory] vector index file could not be loaded', error);
                // Without the file the index has to be rebuilt; the pointer stays until a new index replaces it.
                vectorMemory.dirty = true;
                vectorMemory.dirtyReason = '这台设备读不到向量索引文件';
                vectorMemory.lastIndexedSignature = '';
                return false;
            }
        })();
        loading.set(vectorMemory, run);
        return run;
    }

    return { save, load };
}
