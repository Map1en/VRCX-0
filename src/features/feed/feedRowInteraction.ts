import type { MouseEvent } from 'react';

export function shouldSkipFeedRowToggle(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest('button,a')) {
        return true;
    }
    return Boolean(window.getSelection()?.toString());
}
