import type { KeyboardEvent } from 'react';

const ROW_SELECTOR = '[data-sidebar-row]';
const FOCUSABLE_SELECTOR =
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function handleSidebarRowArrowNavigation(
    event: KeyboardEvent<HTMLElement>
) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
    }
    if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
    ) {
        return;
    }

    const container = event.currentTarget;
    const target = event.target;
    if (!(target instanceof Element) || !container.contains(target)) {
        return;
    }
    const currentRow = target.closest(ROW_SELECTOR);
    if (!currentRow || !container.contains(currentRow)) {
        return;
    }

    const rows = Array.from(container.querySelectorAll(ROW_SELECTOR));
    const step = event.key === 'ArrowDown' ? 1 : -1;
    for (
        let index = rows.indexOf(currentRow) + step;
        index >= 0 && index < rows.length;
        index += step
    ) {
        const focusable =
            rows[index].querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable) {
            event.preventDefault();
            focusable.focus();
            return;
        }
    }
}
