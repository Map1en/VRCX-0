// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntityAvatar } from './EntityAvatar';

afterEach(cleanup);

describe('EntityAvatar', () => {
    it.each([
        ['group', 'lucide-users-round'],
        ['world', 'lucide-globe'],
        ['avatar', 'lucide-person-standing']
    ] as const)('falls back to the %s icon without an image', (kind, icon) => {
        const { container } = render(<EntityAvatar kind={kind} />);

        expect(container.querySelector(`svg.${icon}`)).not.toBeNull();
    });

    it('keeps worlds landscape and other entities square', () => {
        const { container, rerender } = render(<EntityAvatar kind="world" />);
        expect(
            container.querySelector('[data-kind="world"]')?.className
        ).toContain('w-[53px]');

        rerender(<EntityAvatar kind="avatar" />);
        expect(
            container.querySelector('[data-kind="avatar"]')?.className
        ).toContain('w-10');
    });
});
