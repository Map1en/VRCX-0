// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useClearSelectionOnEscape } from './useClearSelectionOnEscape';

afterEach(cleanup);

describe('useClearSelectionOnEscape', () => {
    it('clears on a free Escape but not one a dialog already consumed', () => {
        const clearSelection = vi.fn();
        renderHook(() => useClearSelectionOnEscape(true, clearSelection));
        const consume = (event: KeyboardEvent) => event.preventDefault();

        window.addEventListener('keydown', consume, { capture: true });
        window.dispatchEvent(
            new KeyboardEvent('keydown', { cancelable: true, key: 'Escape' })
        );
        window.removeEventListener('keydown', consume, { capture: true });
        expect(clearSelection).not.toHaveBeenCalled();

        window.dispatchEvent(
            new KeyboardEvent('keydown', { cancelable: true, key: 'Escape' })
        );
        expect(clearSelection).toHaveBeenCalledOnce();
    });
});
