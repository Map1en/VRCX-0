import { useEffect, useEffectEvent, useRef } from 'react';

import {
    TEXT_ENTRY_SELECTOR,
    isKeyboardShortcutBlocked
} from './keyboardShortcutGuards';

export function useImagePasteShortcut<TElement extends HTMLElement>({
    enabled,
    onPaste
}: {
    enabled: boolean;
    onPaste(): void | Promise<void>;
}) {
    const scopeRef = useRef<TElement>(null);
    const handlePasteShortcut = useEffectEvent((event: KeyboardEvent) => {
        if (
            event.defaultPrevented ||
            event.repeat ||
            event.isComposing ||
            event.altKey ||
            event.shiftKey ||
            !(event.ctrlKey || event.metaKey) ||
            event.key.toLowerCase() !== 'v'
        ) {
            return;
        }

        const scope = scopeRef.current;
        if (
            !scope ||
            isKeyboardShortcutBlocked(event, scope, TEXT_ENTRY_SELECTOR)
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
        const listener = (event: KeyboardEvent) => handlePasteShortcut(event);
        window.addEventListener('keydown', listener);
        return () => window.removeEventListener('keydown', listener);
    }, [enabled]);

    return scopeRef;
}
