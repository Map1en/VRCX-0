// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { type PropsWithChildren, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    copyTextToClipboard: vi.fn(),
    registerWorldOpenShare: vi.fn(),
    translate: vi.fn((key: string) => key)
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: mocks.translate
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
    registerWorldOpenShare: mocks.registerWorldOpenShare
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: mocks.copyTextToClipboard
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
    Checkbox: ({
        onCheckedChange,
        ...props
    }: React.ComponentProps<'input'> & {
        onCheckedChange?: (checked: boolean) => void;
    }) => (
        <input
            {...props}
            type="checkbox"
            onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        />
    )
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
const USER_ID = 'usr_12345678-1234-1234-1234-1234567890ab';
const WORLD_ID = 'wrld_12345678-1234-1234-1234-1234567890ab';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

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

describe('FavoriteCard website links', () => {
    it('shows the VRChat website link for a friend', () => {
        const item: FavoriteCardItem = {
            id: USER_ID,
            key: 'friend:remote',
            kind: 'friend',
            source: 'remote',
            title: 'Friend'
        };
        const html = renderToStaticMarkup(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('friend', 'standard')}
            />
        );

        expect(html).toContain('common.actions.view_on_website');
        expect(html).toContain('lucide-external-link');
    });

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

    it('copies the world share text with its entity name', () => {
        const item: FavoriteCardItem = {
            id: WORLD_ID,
            key: 'world:copy-share',
            kind: 'world',
            source: 'remote',
            title: 'Named world'
        };

        render(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('world', 'standard')}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.world.info.copy_vrcx_url'
            })
        );

        expect(mocks.translate).toHaveBeenCalledWith(
            'dialog.world.info.vrcx_share_text',
            {
                name: 'Named world',
                url: `https://open.vrcx-0.dev/world/${WORLD_ID}`
            }
        );
        expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(
            'dialog.world.info.vrcx_share_text',
            expect.any(Object)
        );
        expect(mocks.registerWorldOpenShare).toHaveBeenCalledWith(WORLD_ID);
    });

    it('shows VRChat and share links for a public avatar', () => {
        const html = renderAvatarCard('public');

        expect(html).toContain('lucide-ellipsis');
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

    it('copies the avatar share text with its entity name', () => {
        const item: FavoriteCardItem = {
            id: AVATAR_ID,
            key: 'avatar:copy-share',
            kind: 'avatar',
            source: 'remote',
            title: 'Named avatar',
            seedData: { releaseStatus: 'public' }
        };

        render(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('avatar', 'standard')}
                onAvatarSelect={vi.fn()}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.avatar.info.copy_vrcx_url'
            })
        );

        expect(mocks.translate).toHaveBeenCalledWith(
            'dialog.avatar.info.vrcx_share_text',
            {
                name: 'Named avatar',
                url: `https://open.vrcx-0.dev/avatar/${AVATAR_ID}`
            }
        );
        expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(
            'dialog.avatar.info.vrcx_share_text',
            expect.any(Object)
        );
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

describe('FavoriteCard friend actions', () => {
    it('allows requesting an invite from an offline friend', () => {
        const item: FavoriteCardItem = {
            id: USER_ID,
            key: 'friend:offline',
            kind: 'friend',
            source: 'remote',
            title: 'Offline friend',
            seedData: { state: 'offline' }
        };
        const html = renderToStaticMarkup(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('friend', 'standard')}
                onFriendRequestInvite={vi.fn()}
            />
        );

        expect(html).toContain(
            '<button>dialog.user.actions.request_invite</button>'
        );
    });

    it('routes the remote remove action to its matching callback', () => {
        const item: FavoriteCardItem = {
            id: USER_ID,
            key: 'friend:remove',
            kind: 'friend',
            source: 'remote',
            title: 'Remote friend'
        };
        const onRemoveRemote = vi.fn();

        render(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('friend', 'standard')}
                onRemoveRemote={onRemoveRemote}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.action.remove_favorite'
            })
        );

        expect(onRemoveRemote).toHaveBeenCalledWith(item);
    });
});

describe('FavoriteCard selection and avatar actions', () => {
    it('keeps checkbox selection independent from card activation', () => {
        const item: FavoriteCardItem = {
            id: WORLD_ID,
            key: 'world:selection',
            kind: 'world',
            source: 'remote',
            title: 'Selection world'
        };
        const onToggleSelect = vi.fn();

        render(
            <FavoriteCard
                item={item}
                selectionActive
                selected={false}
                densityConfig={getFavoritesDensityConfig('world', 'standard')}
                onToggleSelect={onToggleSelect}
            />
        );

        fireEvent.click(
            screen.getByRole('checkbox', {
                name: 'common.actions.select Selection world'
            })
        );

        expect(onToggleSelect).toHaveBeenCalledTimes(1);
        expect(onToggleSelect).toHaveBeenCalledWith(
            'world:selection',
            true,
            false
        );
    });

    it('passes the selected avatar item to the avatar action', () => {
        const item: FavoriteCardItem = {
            id: AVATAR_ID,
            key: 'avatar:select',
            kind: 'avatar',
            source: 'remote',
            title: 'Selectable avatar',
            seedData: { releaseStatus: 'public' }
        };
        const onAvatarSelect = vi.fn();

        render(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('avatar', 'standard')}
                onAvatarSelect={onAvatarSelect}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.avatar.actions.select'
            })
        );

        expect(onAvatarSelect).toHaveBeenCalledWith(item);
    });
});

describe('FavoriteCard compact layout', () => {
    it('keeps the friend selection control inside the ring and aligns media padding', () => {
        const item: FavoriteCardItem = {
            id: USER_ID,
            key: 'friend:compact',
            kind: 'friend',
            source: 'remote',
            title: 'friend card'
        };
        const html = renderToStaticMarkup(
            <FavoriteCard
                item={item}
                densityConfig={getFavoritesDensityConfig('friend', 'compact')}
                selected
            />
        );

        expect(html).toContain('absolute top-2 left-2 z-20');
        expect(html).toContain(
            'relative ml-2 flex shrink-0 items-center justify-center'
        );
        expect(html).not.toContain('object-row');
    });

    it.each([
        ['world', WORLD_ID],
        ['avatar', AVATAR_ID]
    ] as const)(
        'uses the compact object surface for a %s without changing the cover layout',
        (kind, id) => {
            const item: FavoriteCardItem = {
                id,
                key: `${kind}:compact`,
                kind,
                source: 'remote',
                title: `${kind} card`
            };
            const html = renderToStaticMarkup(
                <FavoriteCard
                    item={item}
                    densityConfig={getFavoritesDensityConfig(kind, 'compact')}
                    selected
                />
            );

            expect(html).toContain('absolute top-2 left-2 z-20');
            expect(html).toContain('object-row object-row--interactive');
            expect(html).toContain('object-row__media');

            const coverHtml = renderToStaticMarkup(
                <FavoriteCard
                    item={item}
                    densityConfig={getFavoritesDensityConfig(kind, 'standard')}
                />
            );
            expect(coverHtml).not.toContain('object-row');
        }
    );
});
