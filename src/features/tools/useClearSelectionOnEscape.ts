import { useEffect } from 'react';

import { isTextEntryTarget } from '@/components/keyboard/keyboardShortcutGuards';

export function useClearSelectionOnEscape(
    hasSelection: boolean,
    clearSelection: () => void
) {
    useEffect(() => {
        if (!hasSelection) {
            return undefined;
        }
        function handleKeyDown(event: KeyboardEvent) {
            if (
                event.key !== 'Escape' ||
                event.defaultPrevented ||
                isTextEntryTarget(event.target)
            ) {
                return;
            }
            clearSelection();
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [clearSelection, hasSelection]);
}
