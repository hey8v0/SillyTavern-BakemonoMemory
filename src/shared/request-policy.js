export async function runApiRequest({
    url, init = {}, fetchImpl = globalThis.fetch, consume = response => response.json(),
    signal, timeoutMs = 180000, retries = 1,
    formatError = response => `接口请求失败：${response.status} ${response.statusText}`,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; cancel(); }, Math.max(1, timeoutMs));
    let onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(new Error(timedOut
            ? '接口等待超时，本次未自动重发；请确认服务商状态后重试。' : '请求已取消。'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
    });
    const request = async () => {
        if (controller.signal.aborted) return await aborted;
        for (let attempt = 0; ; attempt++) {
            const response = await fetchImpl(url, { ...init, signal: controller.signal });
            if (controller.signal.aborted) return await aborted;
            const retryAfter = response.headers?.get?.('retry-after');
            const delay = retryAfter
                ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
                : 1000 * (attempt + 1);
            if ([429, 503].includes(response.status) && attempt < retries && Number.isFinite(delay) && delay <= 10000) {
                await response.body?.cancel?.();
                await Promise.race([wait(Math.max(0, delay)), aborted]);
                if (controller.signal.aborted) return await aborted;
                continue;
            }
            if (!response.ok) throw new Error(formatError(response));
            return await consume(response, controller.signal);
        }
    };
    try {
        return await Promise.race([aborted, request()]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', onAbort);
        controller.abort();
    }
}
