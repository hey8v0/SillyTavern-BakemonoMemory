// Bring an element into view by scrolling only the workbench's content area.
// Element.scrollIntoView() also scrolls clipped ancestors; on some phone browsers that moved the whole workbench up,
// hiding the header and its close button until the tavern was reloaded.
export function resetWorkbenchFrame(from) {
    for (let node = from?.parentElement; node && node !== node.ownerDocument?.body; node = node.parentElement) {
        if (node.scrollTop) node.scrollTop = 0;
        if (node.scrollLeft) node.scrollLeft = 0;
    }
}

export function scrollIntoMain(element, { block = 'start', offset = 8 } = {}) {
    const main = element?.closest?.('.bakemono-workbench-main');
    if (!main) return false;
    const box = element.getBoundingClientRect();
    const frame = main.getBoundingClientRect();
    const top = box.top - frame.top + main.scrollTop;
    if (block === 'nearest') {
        if (box.top < frame.top) main.scrollTop = Math.max(0, top - offset);
        else if (box.bottom > frame.bottom) main.scrollTop = Math.max(0, top + box.height - main.clientHeight + offset);
    } else {
        main.scrollTop = Math.max(0, top - offset);
    }
    resetWorkbenchFrame(main);
    return true;
}
