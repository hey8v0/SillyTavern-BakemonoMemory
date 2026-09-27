// 开场白: the character messages before the first user message. The card wrote them, not the model, so they carry
// no summary, table edits or state events of their own. They are recorded together with the first reply instead.

// Only once the user has written something: until then a lone character message is simply the latest reply.
export function openingFloors(chat = []) {
    const floors = [];
    for (let index = 0; index < chat.length; index++) {
        const message = chat[index];
        if (!message) continue;
        if (message.is_user) return floors;
        if (!message.is_system && String(message.mes || '').trim()) floors.push(index);
    }
    return [];
}

export function firstUserFloor(chat = []) {
    return chat.findIndex(message => message?.is_user);
}

export function isOpeningFloor(chat = [], floor) {
    return openingFloors(chat).includes(Number(floor));
}

// True while the first reply is being written or re-rolled: nothing but that reply follows the first user message.
export function isFirstReplyTurn(chat = []) {
    const first = firstUserFloor(chat);
    if (first < 0 || !openingFloors(chat).length) return false;
    const after = chat.slice(first + 1).filter(message => message && !message.is_system);
    return !after.length || (after.length === 1 && !after[0].is_user);
}

export function openingText(chat = [], clean = value => String(value || '')) {
    return openingFloors(chat).map(floor => clean(chat[floor].mes)).filter(text => text.trim()).join('\n\n');
}

export function openingNote(part) {
    return `上面第一条角色消息是开场白，它的${part}还没有记录。本轮请连同开场白里已经发生的内容一起记上，不要单独重复。`;
}
