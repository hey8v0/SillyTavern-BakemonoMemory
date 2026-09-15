import { readChatSource } from '../../src/rp-core/chat-sources.js';
import { prepareExtraction } from '../../src/rp-core/extraction.js';

// Seed pre-upgrade pending data to retain recovery/compatibility coverage. Never used by runtime code.
export function seedLegacyExtraction(state, chat, raw, floor) {
    const source = readChatSource(chat[floor], state, { allocate: true });
    const prepared = prepareExtraction(state.rpCore, raw, source, { floor: Math.max(0, chat.length - 1), order: floor,
        automaticRegistration: true, autoApply: state.rpCore.settings.autoApply === true, allowNewOnRepeat: true });
    state.rpCore = prepared.core;
    return prepared;
}
