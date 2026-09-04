import React, { type PropsWithChildren, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/friends/FriendInstanceTimer', () => ({
    FriendInstanceTimer: () => <span data-instance-timer />,
    FriendLocationTimer: ({
        location,
        userId
    }: {
        location: string;
        userId: string;
    }) => <span data-location={location} data-user-id={userId} />
}));

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: PropsWithChildren) => children
}));

vi.mock('@/components/UserDetailTile', () => ({
    UserDetailContent: ({ subline }: { subline?: ReactNode }) => (
        <div>{subline}</div>
    )
}));

vi.mock('@/ui/shadcn/context-menu', () => ({
    ContextMenu: ({ children }: PropsWithChildren) => children,
    ContextMenuCheckboxItem: () => null,
    ContextMenuContent: () => null,
    ContextMenuGroup: () => null,
    ContextMenuItem: () => null,
    ContextMenuSeparator: () => null,
    ContextMenuSub: () => null,
    ContextMenuSubContent: () => null,
    ContextMenuSubTrigger: () => null,
    ContextMenuTrigger: ({ render }: { render: ReactNode }) => render
}));

vi.mock('./FriendsSidebarActionItems', () => ({
    CurrentUserActionItems: () => null,
    FriendActionItems: () => null
}));

import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';

import { FriendRow } from './FriendsSidebarFriendRow';

const remoteLocation = 'wrld_friends:1';

function renderRemoteFriend(userId: string, isGameRunning: boolean) {
    return renderToStaticMarkup(
        <FriendRow
            friend={{
                id: userId,
                displayName: userId,
                state: 'online',
                location: remoteLocation
            }}
            rowModel={{
                isGroupByInstance: true,
                instanceLocation: remoteLocation
            }}
            appearance={{ isGameRunning }}
        />
    );
}

describe('FriendsSidebarFriendRow instance timer', () => {
    beforeEach(() => {
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_a',
                location: remoteLocation,
                sinceMs: 1_000,
                source: 'realtime'
            },
            {
                userId: 'usr_b',
                location: remoteLocation,
                sinceMs: 2_000,
                source: 'realtime'
            }
        ]);
    });

    it('keeps remote friend timer inputs when the current user starts the game elsewhere', () => {
        for (const userId of ['usr_a', 'usr_b']) {
            const before = renderRemoteFriend(userId, false);
            const after = renderRemoteFriend(userId, true);

            expect(before).toContain(`data-user-id="${userId}"`);
            expect(before).toContain(`data-location="${remoteLocation}"`);
            expect(after).toContain(`data-user-id="${userId}"`);
            expect(after).toContain(`data-location="${remoteLocation}"`);
        }
    });
});
