// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStableCommands } from './useStableCommands';

describe('useStableCommands', () => {
    it('keeps the command object stable while calling the latest handlers', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { result, rerender } = renderHook(
            ({ onSelect }: { onSelect: (id: string) => void }) =>
                useStableCommands({ onSelect }),
            { initialProps: { onSelect: first } }
        );
        const initial = result.current;

        rerender({ onSelect: second });
        result.current.onSelect('usr_a');

        expect(result.current).toBe(initial);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith('usr_a');
    });

    it('returns a new object when a command becomes available or unavailable', () => {
        const initialProps: { onCopy?: () => void } = {};
        const { result, rerender } = renderHook(
            ({ onCopy }: { onCopy?: () => void }) =>
                useStableCommands({ onCopy }),
            { initialProps }
        );
        const withoutCopy = result.current;
        expect(withoutCopy.onCopy).toBeUndefined();

        const onCopy = vi.fn();
        rerender({ onCopy });
        const withCopy = result.current;
        withCopy.onCopy?.();

        expect(withCopy).not.toBe(withoutCopy);
        expect(onCopy).toHaveBeenCalledTimes(1);

        rerender({ onCopy: undefined });
        expect(result.current).not.toBe(withCopy);
        expect(result.current.onCopy).toBeUndefined();
    });
});
