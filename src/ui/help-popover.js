export function createHelpPopover({
    rootId = 'bakemono-workbench-root',
    popoverId = 'bakemono-memory-help-popover',
} = {}) {
    let activeTrigger = null;
    let boundRoot = null;
    let boundScroller = null;

    function close() {
        activeTrigger?.setAttribute('aria-expanded', 'false');
        activeTrigger = null;
        document.getElementById(popoverId)?.remove();
    }

    function position(trigger, popover) {
        if (!trigger?.isConnected || !popover?.isConnected) {
            close();
            return;
        }
        const margin = 10;
        const gap = 8;
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        const triggerRect = trigger.getBoundingClientRect();
        const width = Math.min(320, viewportWidth - margin * 2);
        popover.style.width = `${width}px`;
        const height = popover.getBoundingClientRect().height;
        const center = triggerRect.left + triggerRect.width / 2;
        const left = Math.max(margin, Math.min(center - width / 2, viewportWidth - width - margin));
        const showAbove = triggerRect.bottom + gap + height > viewportHeight - margin
            && triggerRect.top - gap - height >= margin;
        const top = showAbove
            ? triggerRect.top - gap - height
            : Math.min(triggerRect.bottom + gap, viewportHeight - height - margin);
        popover.style.left = `${left}px`;
        popover.style.top = `${Math.max(margin, top)}px`;
        popover.style.setProperty('--bakemono-help-arrow-left', `${Math.max(18, Math.min(center - left, width - 18))}px`);
        popover.classList.toggle('is-above', showAbove);
    }

    function toggle(trigger) {
        if (!trigger) return;
        if (activeTrigger === trigger) {
            close();
            return;
        }
        close();
        const source = trigger.querySelector('.bakemono-memory-help-content');
        if (!source) return;
        const popover = document.createElement('div');
        popover.id = popoverId;
        popover.className = 'bakemono-memory-help-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', trigger.getAttribute('aria-label') || '帮助说明');
        popover.innerHTML = source.innerHTML;
        document.getElementById(rootId)?.appendChild(popover);
        activeTrigger = trigger;
        trigger.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => position(trigger, popover));
    }

    function closeIfInside(container) {
        if (activeTrigger && container?.contains(activeTrigger)) close();
    }

    function handleRootClick(event) {
        const trigger = event.target?.closest?.('.bakemono-memory-help-trigger');
        if (!trigger || !boundRoot?.contains(trigger)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        toggle(trigger);
    }

    function handleRootKeydown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const trigger = event.target?.closest?.('.bakemono-memory-help-trigger');
        if (!trigger || !boundRoot?.contains(trigger)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        toggle(trigger);
    }

    function handleDetailsToggle(event) {
        const details = event.target?.closest?.('details');
        if (details && !details.open) closeIfInside(details);
    }

    function handleDocumentClick(event) {
        if (!event.target?.closest?.(`.bakemono-memory-help-trigger, #${popoverId}`)) close();
    }

    function handleDocumentKeydown(event) {
        if (event.key === 'Escape') close();
    }

    function unbind() {
        boundRoot?.removeEventListener('click', handleRootClick);
        boundRoot?.removeEventListener('keydown', handleRootKeydown);
        boundRoot?.removeEventListener('toggle', handleDetailsToggle, true);
        boundScroller?.removeEventListener('scroll', close);
        document.removeEventListener('click', handleDocumentClick);
        document.removeEventListener('keydown', handleDocumentKeydown);
        window.removeEventListener('resize', close);
        boundRoot = null;
        boundScroller = null;
    }

    function bind(root, scroller = root?.querySelector('.bakemono-workbench-main')) {
        if (boundRoot === root && boundScroller === scroller) return;
        unbind();
        boundRoot = root || null;
        boundScroller = scroller || null;
        boundRoot?.addEventListener('click', handleRootClick);
        boundRoot?.addEventListener('keydown', handleRootKeydown);
        boundRoot?.addEventListener('toggle', handleDetailsToggle, true);
        boundScroller?.addEventListener('scroll', close);
        document.addEventListener('click', handleDocumentClick);
        document.addEventListener('keydown', handleDocumentKeydown);
        window.addEventListener('resize', close);
    }

    return { bind, close, closeIfInside, toggle, unbind };
}
