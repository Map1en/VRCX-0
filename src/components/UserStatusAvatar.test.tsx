// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { UserStatusAvatar } from './UserStatusAvatar';

afterEach(cleanup);

describe('UserStatusAvatar', () => {
    it('scales the ringed status dot with the avatar size', () => {
        const { container, rerender } = render(
            <UserStatusAvatar size="sm" statusDotClassName="bg-status-online" />
        );
        const dotWidth = () =>
            Number.parseFloat(
                container.querySelector<HTMLElement>(
                    '[data-size] > span.absolute'
                )?.style.width ?? '0'
            );
        const small = dotWidth();

        rerender(
            <UserStatusAvatar size="lg" statusDotClassName="bg-status-online" />
        );
        expect(dotWidth()).toBeGreaterThan(small);
    });

    it('sizes the avatar from its size token', () => {
        const { container } = render(<UserStatusAvatar size="lg" />);
        const root = container.querySelector<HTMLElement>('[data-size="lg"]');
        expect(root?.style.width).toBe('40px');
    });
});
