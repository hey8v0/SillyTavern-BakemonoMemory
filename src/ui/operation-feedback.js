export function createOperationFeedback({
    escapeHtml,
    setBusy,
    renderScope,
    getDefaultRenderScope,
    logError = (...args) => console.error(...args),
    rootId = 'bakemono-workbench-root',
    toastId = 'bakemono-memory-operation-toast',
} = {}) {
    let timer = null;
    let captureUntil = 0;
    let captureRoot = null;

    const importantControlSelector = [
        '[data-bakemono-action]',
        '[data-bakemono-draft-action]',
        '[data-bakemono-auto-tx-action]',
        '[data-bakemono-table-draft-action]',
        '[data-bakemono-table-action="save-table"]',
        'button[id*="apply"]',
        'button[id*="save"]',
        'button[id*="undo"]',
        'button[id*="redo"]',
        'button[id*="restore"]',
    ].join(',');

    function clear() {
        if (timer) {
            window.clearTimeout(timer);
            timer = null;
        }
        document.getElementById(toastId)?.remove();
        document.getElementById(rootId)?.classList.remove('is-operation-running');
    }

    function set(state = '', message = '', timeout = 0) {
        const root = document.getElementById(rootId);
        const text = String(message || '').trim();
        if (!root || !state || !text) {
            clear();
            return;
        }
        if (timer) {
            window.clearTimeout(timer);
            timer = null;
        }
        let toast = document.getElementById(toastId);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = toastId;
            toast.className = 'bakemono-memory-operation-toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            root.appendChild(toast);
        }
        const icon = state === 'running'
            ? '<span class="bakemono-memory-operation-spinner" aria-hidden="true"></span>'
            : `<i class="fa-solid ${state === 'success' ? 'fa-check' : 'fa-triangle-exclamation'}" aria-hidden="true"></i>`;
        toast.className = `bakemono-memory-operation-toast is-${state}`;
        toast.innerHTML = `${icon}<span>${escapeHtml?.(text) ?? text}</span>`;
        root.classList.toggle('is-operation-running', state === 'running');
        if (timeout > 0) timer = window.setTimeout(clear, timeout);
    }

    function armCapture(duration = 10000) {
        captureUntil = Date.now() + Math.max(0, Number(duration) || 0);
    }

    function resetCapture() {
        captureUntil = 0;
    }

    function handleCaptureClick(event) {
        if (event.target?.closest?.(importantControlSelector)) armCapture(2500);
    }

    function bindCapture(root) {
        if (captureRoot === root) return;
        captureRoot?.removeEventListener('click', handleCaptureClick, true);
        captureRoot = root || null;
        captureRoot?.addEventListener('click', handleCaptureClick, true);
    }

    function captureFromStatus(statusText = '') {
        const text = String(statusText || '').trim();
        if (!text || Date.now() > captureUntil) return;
        if (/^(已取消|取消)/.test(text)) {
            captureUntil = 0;
            clear();
            return;
        }
        if (/^(正在|开始)/.test(text)) {
            set('running', text);
            return;
        }
        captureUntil = 0;
        const failed = /(失败|错误|异常)/.test(text);
        set(failed ? 'error' : 'success', text, failed ? 2600 : 1200);
    }

    async function runGeneration(message, action, successMessage = '生成完成', scope = getDefaultRenderScope?.()) {
        set('running', message);
        renderScope?.(scope, message);
        setBusy?.(true);
        try {
            await action();
            set('success', successMessage, 1200);
        } catch (error) {
            logError('[BakemonoMemory] generation failed', error);
            const failure = `生成失败：${error?.message || error}`;
            set('error', failure, 2600);
            renderScope?.(scope, failure);
        } finally {
            setBusy?.(false);
        }
    }

    async function runVisible(message, action, successMessage = '操作完成') {
        set('running', message);
        setBusy?.(true);
        try {
            const result = await action();
            if (result === false) {
                clear();
                return result;
            }
            set('success', successMessage, 1200);
            return result;
        } catch (error) {
            set('error', error?.message || String(error), 2600);
            throw error;
        } finally {
            setBusy?.(false);
        }
    }

    return {
        armCapture,
        bindCapture,
        captureFromStatus,
        clear,
        resetCapture,
        runGeneration,
        runVisible,
        set,
    };
}
