import { RP_EVENT_GUIDE } from './prompt.js';

export function createRpPromptLibrary({ read, write, confirmSave = async () => ({ status: 'unconfirmed' }) }) {
    const get = () => {
        const stored = read();
        if (stored && stored.version !== 1) throw new Error('提示词预设版本不支持');
        return stored || { version: 1, revision: 0, promptVersion: 2, activePrompt: RP_EVENT_GUIDE, selectedId: 'default', presets: [] };
    };
    const list = () => [{ id: 'default', name: '默认剧情状态', prompt: RP_EVENT_GUIDE }, ...get().presets].map(item => ({ ...item }));
    const current = () => get().activePrompt;
    const draft = () => { const config = get(); return { revision: config.revision, selectedId: config.selectedId,
        name: list().find(item => item.id === config.selectedId)?.name || '', prompt: config.activePrompt, promptVersion: config.promptVersion || 1 }; };
    function load(id) {
        const preset = list().find(item => item.id === id);
        if (!preset) throw new Error('预设不存在');
        return { revision: get().revision, selectedId: id, name: preset.name, prompt: preset.prompt, promptVersion: preset.prompt === RP_EVENT_GUIDE ? 2 : 1 };
    }
    async function commit(action, value) {
        const config = get();
        if (value.revision !== config.revision) throw new Error('提示词设置已变化，请重新载入');
        if (!['apply', 'save-as', 'overwrite', 'delete'].includes(action)) throw new Error('预设操作无效');
        const next = structuredClone(config), selected = next.presets.find(item => item.id === value.selectedId);
        if (['overwrite', 'delete'].includes(action) && !selected) throw new Error('内置预设不能覆盖或删除，请另存');
        if (action !== 'delete' && (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 30000)) throw new Error('提示词不能为空或超过 30000 字');
        if (['save-as', 'overwrite'].includes(action) && (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80)) throw new Error('请填写预设名称（最多 80 字）');
        if (action === 'save-as') {
            if (next.presets.length >= 100) throw new Error('预设最多保存 100 个');
            next.selectedId = 'rp-prompt-' + (config.revision + 1);
            next.presets.push({ id: next.selectedId, name: value.name.trim(), prompt: value.prompt });
        } else if (action === 'overwrite') { selected.name = value.name.trim(); selected.prompt = value.prompt; next.selectedId = selected.id; }
        else if (action === 'delete') { next.presets = next.presets.filter(item => item.id !== selected.id); if (next.selectedId === selected.id) next.selectedId = ''; }
        else next.selectedId = list().some(item => item.id === value.selectedId) ? value.selectedId : '';
        if (action !== 'delete') { next.activePrompt = value.prompt; next.promptVersion = value.prompt === RP_EVENT_GUIDE ? 2 : 1; }
        next.revision++;
        write(structuredClone(next));
        try { return await confirmSave(structuredClone(next)); }
        catch { return { status: 'unconfirmed' }; }
    }
    return { current, draft, load, list, commit };
}
