// The vector index lives in files on the tavern server (SillyTavern's user files), not in the chat file.
// A chat file is rewritten on every message, so thousands of embeddings inside it made every save upload megabytes.
// The index is split by floor range, one file per SIDECAR_FLOORS floors, so a new reply rewrites only the newest part.
// The chat keeps a pointer: { signature, count, parts: { [range]: { path, signature, count } } }.
import { encodeEmbedding, decodeEmbedding, vectorRecordsSignature as signatureOf } from './storage.js';

export const vectorRecordsSignature = records => signatureOf(records);
export const SIDECAR_FLOORS = 200;

// SillyTavern accepts only letters, digits, '_', '-' and '.' in upload names.
export function vectorSidecarName(chatKey, getHash, part = '') {
    const key = String(chatKey || 'chat');
    return `bakemono-vectors-${getHash(key)}${getHash([...key].reverse().join(''))}${part === '' ? '' : '-' + part}.json`;
}

const partOf = record => String(Math.floor((Number.isFinite(Number(record.messageId)) ? Number(record.messageId) : 0) / SIDECAR_FLOORS));

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
}

export function createVectorSidecar({ fetchImpl = (...args) => fetch(...args), getHeaders = () => ({}), getChatKey = () => '', getHash, warn = () => {} } = {}) {
    const loading = new WeakMap();

    async function upload(name, payload) {
        const response = await fetchImpl('/api/files/upload', { method: 'POST', headers: { ...getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data: toBase64(JSON.stringify(payload)) }) });
        if (!response.ok) throw new Error(`向量索引文件没有写入（${response.status}）`);
        const { path } = await response.json();
        if (!path) throw new Error('向量索引文件没有返回位置');
        return String(path);
    }

    async function save(vectorMemory) {
        const records = vectorMemory?.records || [];
        if (!records.length) return null;
        const signature = vectorRecordsSignature(records);
        if (vectorMemory.sidecar?.signature === signature) return vectorMemory.sidecar;
        const groups = new Map();
        for (const record of records) {
            const key = partOf(record);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(record);
        }
        const previous = vectorMemory.sidecar?.parts || {}, parts = {};
        for (const [key, list] of groups) {
            const partSignature = vectorRecordsSignature(list);
            if (previous[key]?.signature === partSignature) { parts[key] = previous[key]; continue; }
            const path = await upload(vectorSidecarName(getChatKey(), getHash, key), { format: 'bakemono-vectors', version: 2, part: key, signature: partSignature,
                records: list.map(record => ({ ...record, embedding: typeof record.embedding === 'string' ? record.embedding : encodeEmbedding(record.embedding) })) });
            parts[key] = { path, signature: partSignature, count: list.length };
        }
        // Only now the chat file may drop the records: the files hold exactly these.
        if (vectorRecordsSignature(vectorMemory.records) !== signature) return null;
        vectorMemory.sidecar = { signature, count: records.length, parts, savedAt: new Date().toISOString() };
        return vectorMemory.sidecar;
    }

    async function fetchPart(path, signature) {
        const url = '/' + String(path).replace(/\\/g, '/').replace(/^\/+/, '') + '?v=' + encodeURIComponent(signature);
        const response = await fetchImpl(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`向量索引文件读取失败（${response.status}）`);
        const payload = await response.json();
        if (payload?.format !== 'bakemono-vectors' || payload.signature !== signature || !Array.isArray(payload.records)) throw new Error('向量索引文件与聊天记录不一致');
        return payload.records;
    }

    // Fills vectorMemory.records from the files when the chat was saved without them. Resolves to true when loaded.
    function load(vectorMemory) {
        const pointer = vectorMemory?.sidecar;
        const parts = pointer?.parts ? Object.values(pointer.parts) : pointer?.path ? [{ path: pointer.path, signature: pointer.signature }] : [];
        if (!parts.length || vectorMemory.records?.length) return Promise.resolve(false);
        if (loading.has(vectorMemory)) return loading.get(vectorMemory);
        const run = (async () => {
            try {
                const records = (await Promise.all(parts.map(part => fetchPart(part.path, part.signature)))).flat()
                    .map(record => ({ ...record, embedding: decodeEmbedding(record.embedding) }));
                // Split pointers are checked as a whole; a single file from 1.25.1 was already checked against its own signature.
                if (pointer.parts && vectorRecordsSignature(records) !== pointer.signature) throw new Error('向量索引文件不完整');
                if (vectorMemory.records?.length) return false;
                vectorMemory.records = records;
                return true;
            } catch (error) {
                warn('[BakemonoMemory] vector index file could not be loaded', error);
                // Without the files the index has to be rebuilt; the pointer stays until a new index replaces it.
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
