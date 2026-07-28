import React, { type PropsWithChildren, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/components/Location', () => ({
    Location: () => null
}));

vi.mock('@/components/media/FadeInImage', () => ({
    FadeInImage: () => null
}));

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: PropsWithChildren) => children
}));

vi.mock('@/components/UserStatusDot', () => ({
    UserStatusDot: () => null
}));

vi.mock('@/repositories/worldProfileRepository', () => ({
    registerWorldOpenShare: vi.fn()
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: vi.fn()
}));

vi.mock('@/services/dialogService', () => ({
    openAvatarDialog: vi.fn(),
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserId: string;
                currentUserSnapshot: { currentAvatar: string };
            };
            gameState: { isGameRunning: boolean };
        }) => T
    ) =>
        selector({
            auth: {
                currentUserId: 'usr_current',
                currentUserSnapshot: { currentAvatar: 'avtr_current' }
            },
            gameState: { isGameRunning: false }
        })
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        size: _size,
        variant: _variant,
        ...props
    }: PropsWithChildren<{
        size?: unknown;
        variant?: unknown;
    }>) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/checkbox', () => ({
    Checkbox: () => <input type="checkbox" />
}));

vi.mock('@/ui/shadcn/dropdown-menu', () => {
    const Container = ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    );

    return {
        DropdownMenu: Container,
        DropdownMenuContent: Container,
        DropdownMenuGroup: Container,
        DropdownMenuItem: ({
            children,
            variant: _variant,
            ...props
        }: PropsWithChildren<{ variant?: unknown }>) => (
            <button {...props}>{children}</button>
        ),
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuTrigger: ({ render }: { render?: ReactNode }) => render
    };
});

vi.mock('@/ui/shadcn/spinner', () => ({
    Spinner: () => null
}));

import { getFavoritesDensityConfig } from '../favoritesDensity';
import { FavoriteCard, type FavoriteCardItem } from './FavoriteCard';

const AVATAR_ID = 'avtr_12345678-1234-1234-1234-1234567890ab';
const WORLD_ID = 'wrld_12345678-1234-1234-1234-1234567890ab';

function renderAvatarCard(
    releaseStatus: 'public' | 'private',
    isPrivate = releaseStatus === 'private'
) {
    const item: FavoriteCardItem = {
        id: AVATAR_ID,
        key: `avatar:${releaseStatus}`,
        kind: 'avatar',
        source: 'remote',
        title: `${releaseStatus} avatar`,
        isPrivate,
        seedData: { releaseStatus }
    };

    return renderToStaticMarkup(
        <FavoriteCard
            item={item}
            densityConfig={getFavoritesDensityConfig('avatar', 'standard')}
            onAvatarSelect={vi.fn()}
        />
    );
}

describe('FavoriteCard avatar links', () => {
    it('shows matching link icons for a world', () => {
        const item: FavoriteCardItem = {
            id: WORLD_ID,
            key: 'world:public',
            kind: 'world',
            source: 'remote',
            title: 'public world'
        };
        const html = renderToStaticMarkup(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('world', 'standard')}
            />
        );

        expect(html).toContain('common.actions.view_on_website');
        expect(html).toContain('dialog.world.info.copy_vrcx_url');
        expect(html).toContain('lucide-external-link');
        expect(html).toContain('lucide-share-2');
    });

    it('shows VRChat and share links for a public avatar', () => {
        const html = renderAvatarCard('public');

        expect(html).toContain('common.actions.view_on_website');
        expect(html).toContain('dialog.avatar.info.copy_vrcx_url');
        expect(html).toContain('lucide-external-link');
        expect(html).toContain('lucide-share-2');
        const shareLinkIndex = html.indexOf('dialog.avatar.info.copy_vrcx_url');
        const separatorIndex = html.indexOf('<hr', shareLinkIndex);
        const selectIndex = html.indexOf('dialog.avatar.actions.select');
        expect(separatorIndex).toBeGreaterThan(shareLinkIndex);
        expect(selectIndex).toBeGreaterThan(separatorIndex);
    });

    it('shows only the VRChat link for a private avatar', () => {
        const html = renderAvatarCard('private');

        expect(html).toContain('common.actions.view_on_website');
        expect(html).not.toContain('dialog.avatar.info.copy_vrcx_url');
        expect(html).toContain('lucide-external-link');
        expect(html).not.toContain('lucide-share-2');
        const websiteLinkIndex = html.indexOf('common.actions.view_on_website');
        const separatorIndex = html.indexOf('<hr', websiteLinkIndex);
        const selectIndex = html.indexOf('dialog.avatar.actions.select');
        expect(separatorIndex).toBeGreaterThan(websiteLinkIndex);
        expect(selectIndex).toBeGreaterThan(separatorIndex);
    });

    it('hides the share link for a cached public avatar with a private lock', () => {
        const html = renderAvatarCard('public', true);

        expect(html).toContain('common.actions.view_on_website');
        expect(html).not.toContain('dialog.avatar.info.copy_vrcx_url');
        expect(html).toContain('lucide-external-link');
        expect(html).not.toContain('lucide-share-2');
    });
});
