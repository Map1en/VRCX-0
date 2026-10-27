import { useEffect, useEffectEvent, useRef } from 'react';

import {
    TEXT_ENTRY_SELECTOR,
    isShortcutBlocked
} from './keyboardShortcutGuards';

function isPasteKey(event: KeyboardEvent) {
    return (
        !event.repeat &&
        !event.isComposing &&
        !event.altKey &&
        !event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'v'
    );
}

export function useImagePasteShortcut<TElement extends HTMLElement>({
    enabled,
    onPaste
}: {
    enabled: boolean;
    onPaste(): void | Promise<void>;
}) {
    const scopeRef = useRef<TElement>(null);
    const handlePaste = useEffectEvent((event: Event) => {
        const scope = scopeRef.current;
        if (
            event.defaultPrevented ||
            (event instanceof KeyboardEvent && !isPasteKey(event)) ||
            !scope ||
            isShortcutBlocked(event, scope, TEXT_ENTRY_SELECTOR)
        ) {
            return;
        }

        event.preventDefault();
        void onPaste();
    });

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const listener = (event: Event) => handlePaste(event);
        window.addEventListener('keydown', listener);
        window.addEventListener('paste', listener);
        return () => {
            window.removeEventListener('keydown', listener);
            window.removeEventListener('paste', listener);
        };
    }, [enabled]);

    return scopeRef;
}
