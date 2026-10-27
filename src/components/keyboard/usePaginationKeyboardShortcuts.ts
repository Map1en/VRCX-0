import { useEffect, useEffectEvent, useRef } from 'react';

import {
    KEYBOARD_CONTROL_SELECTOR,
    isKeyboardShortcutBlocked
} from './keyboardShortcutGuards';

export function usePaginationKeyboardShortcuts<TElement extends HTMLElement>({
    enabled = true,
    canPrevious,
    canNext,
    onPrevious,
    onNext
}: {
    enabled?: boolean;
    canPrevious: boolean;
    canNext: boolean;
    onPrevious(): void;
    onNext(): void;
}) {
    const paginationRef = useRef<TElement>(null);
    const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (
            event.defaultPrevented ||
            event.repeat ||
            event.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        ) {
            return;
        }

        const pagination = paginationRef.current;
        if (
            !pagination ||
            window.getSelection()?.isCollapsed === false ||
            isKeyboardShortcutBlocked(
                event,
                pagination,
                KEYBOARD_CONTROL_SELECTOR
            )
        ) {
            return;
        }

        if (event.key === 'ArrowLeft' ? canPrevious : canNext) {
            event.preventDefault();
            if (event.key === 'ArrowLeft') {
                onPrevious();
            } else {
                onNext();
            }
        }
    });

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const listener = (event: KeyboardEvent) => handleKeyDown(event);
        window.addEventListener('keydown', listener);
        return () => window.removeEventListener('keydown', listener);
    }, [enabled]);

    return paginationRef;
}
