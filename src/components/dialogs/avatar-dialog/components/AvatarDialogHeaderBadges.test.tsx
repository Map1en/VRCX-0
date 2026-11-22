// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AvatarDialogHeaderBadges } from './AvatarDialogHeaderBadges';

afterEach(cleanup);

describe('AvatarDialogHeaderBadges', () => {
    it('lists content warnings and avatar features', () => {
        render(
            <AvatarDialogHeaderBadges
                avatarBlocked={false}
                contentTags={['content_sex']}
                hasImposter
                imposterVersion="1.1"
                isFallback={false}
                isMarketplace
            />
        );

        expect(screen.getByText('sex')).toBeTruthy();
        expect(
            screen.getByText('dialog.avatar.tags.impostor v1.1')
        ).toBeTruthy();
        expect(screen.getByText('dialog.avatar.tags.marketplace')).toBeTruthy();
    });

    it('renders nothing for a plain avatar', () => {
        const { container } = render(
            <AvatarDialogHeaderBadges
                avatarBlocked={false}
                contentTags={[]}
                hasImposter={false}
                imposterVersion=""
                isFallback={false}
                isMarketplace={false}
            />
        );

        expect(container.textContent).toBe('');
    });

    it('folds badges past the limit into a count', () => {
        render(
            <AvatarDialogHeaderBadges
                avatarBlocked
                contentTags={[
                    'content_horror',
                    'content_gore',
                    'content_violence',
                    'content_adult',
                    'content_sex'
                ]}
                hasImposter
                imposterVersion=""
                isFallback
                isMarketplace={false}
            />
        );

        expect(screen.getByText('dialog.avatar.error.blocked')).toBeTruthy();
        expect(screen.getByText('+2')).toBeTruthy();
    });
});
