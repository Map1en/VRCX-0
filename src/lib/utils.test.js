import { describe, expect, it } from 'vitest';

import { cn } from './utils.js';

describe('utils', () => {
    it('joins conditional class values', () => {
        const isHidden = false;

        expect(cn('flex', isHidden && 'hidden', ['items-center'])).toBe(
            'flex items-center'
        );
    });

    it('merges conflicting Tailwind classes with later values winning', () => {
        expect(cn('px-2 text-sm', 'px-4', { 'text-lg': true })).toBe(
            'px-4 text-lg'
        );
    });
});
