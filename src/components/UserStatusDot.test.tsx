import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UserStatusDot } from './UserStatusDot';

describe('UserStatusDot', () => {
    it('renders nothing without a status class', () => {
        expect(renderToStaticMarkup(<UserStatusDot />)).toBe('');
    });

    it('draws the avatar status shape on a background-filled backdrop', () => {
        expect(
            renderToStaticMarkup(
                <UserStatusDot statusDotClassName="user-status-indicator joinme bg-[var(--status-joinme)]" />
            )
        ).toBe(
            '<span class="border-background bg-background rounded-full border-3"><span class="absolute inset-0 rounded-full user-status-indicator joinme bg-[var(--status-joinme)]"></span></span>'
        );
    });
});
