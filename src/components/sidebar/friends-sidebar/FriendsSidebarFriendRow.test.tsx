import type { PropsWithChildren, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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
    UserDetailContent: ({
        avatarFrame,
        subline,
        statusDotClassName
    }: {
        avatarFrame?: ReactNode;
        subline?: ReactNode;
        statusDotClassName?: string;
    }) => (
        <div data-status-dot={statusDotClassName}>
            {avatarFrame}
            {subline}
        </div>
    )
}));

vi.mock('@/components/ProfileDecorations', () => ({
    ProfileAvatarFrame: ({
        templateId,
        active
    }: {
        templateId: string;
        active: boolean;
    }) => <span data-avatar-frame={templateId} data-active={active} />,
    ProfileNameplate: ({
        templateId,
        active
    }: {
        templateId: string;
        active: boolean;
    }) => <span data-nameplate={templateId} data-active={active} />,
    useDecorationHover: () => ({ active: false, hoverProps: {} })
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

import {
    activePresence,
    onlinePresence,
    pendingPresence,
    travelingPresence
} from '@/test/presenceFixtures';

import { FriendRow } from './FriendsSidebarFriendRow';

describe('FriendsSidebarFriendRow instance timer', () => {
    it('times a remote friend in a grouped instance by that instance location', () => {
        const html = renderToStaticMarkup(
            <FriendRow
                friend={{
                    id: 'usr_a',
                    displayName: 'usr_a',
                    state: 'online',
                    location: 'wrld_friends:1'
                }}
                rowModel={{
                    isGroupByInstance: true,
                    instanceLocation: 'wrld_friends:1'
                }}
            />
        );

        expect(html).toContain('data-user-id="usr_a"');
        expect(html).toContain('data-location="wrld_friends:1"');
    });

    it('shows the status dot for the current user even though VRChat marks the self record as not a friend', () => {
        const html = renderToStaticMarkup(
            <FriendRow
                friend={{
                    id: 'usr_self',
                    displayName: 'Self',
                    status: 'active',
                    isFriend: false,
                    $presence: activePresence()
                }}
                rowModel={{ isCurrentUser: true }}
            />
        );

        expect(html).toContain('data-status-dot="user-status-indicator');
    });
});

describe('FriendsSidebarFriendRow profile decorations', () => {
    const friend = {
        id: 'usr_a',
        displayName: 'Friend',
        iconFrame: 'invt_frame',
        nameplateEffect: 'invt_plate'
    };

    it('renders the avatar frame and nameplate independently when enabled', () => {
        const frameOnly = renderToStaticMarkup(
            <FriendRow friend={friend} appearance={{ showAvatarFrame: true }} />
        );
        const nameplateOnly = renderToStaticMarkup(
            <FriendRow friend={friend} appearance={{ showNameplate: true }} />
        );

        expect(frameOnly).toContain('data-avatar-frame="invt_frame"');
        expect(frameOnly).not.toContain('data-nameplate');
        expect(nameplateOnly).toContain('data-nameplate="invt_plate"');
        expect(nameplateOnly).not.toContain('data-avatar-frame');
    });

    it('renders no decorations by default', () => {
        const html = renderToStaticMarkup(<FriendRow friend={friend} />);

        expect(html).not.toContain('data-avatar-frame');
        expect(html).not.toContain('data-nameplate');
    });
});

describe('FriendsSidebarFriendRow pending offline', () => {
    it('mutes the whole row only while the friend may be offline', () => {
        const pending = renderToStaticMarkup(
            <FriendRow
                friend={{
                    id: 'usr_a',
                    displayName: 'Friend',
                    $presence: pendingPresence()
                }}
            />
        );
        const online = renderToStaticMarkup(
            <FriendRow
                friend={{
                    id: 'usr_a',
                    displayName: 'Friend',
                    $presence: onlinePresence()
                }}
            />
        );

        expect(pending).toContain('data-pending-offline="true"');
        expect(pending).toContain('side_panel.pending_offline');
        expect(online).not.toContain('data-pending-offline=');
    });
});

describe('FriendsSidebarFriendRow traveling', () => {
    const friend = {
        id: 'usr_a',
        displayName: 'Friend',
        iconFrame: 'invt_frame',
        nameplateEffect: 'invt_plate'
    };

    it('keeps the avatar frame and nameplate animated while the friend is traveling', () => {
        const traveling = renderToStaticMarkup(
            <FriendRow
                friend={{
                    ...friend,
                    $presence: travelingPresence('wrld_next:1')
                }}
                appearance={{ showAvatarFrame: true, showNameplate: true }}
            />
        );
        const settled = renderToStaticMarkup(
            <FriendRow
                friend={{ ...friend, $presence: onlinePresence() }}
                appearance={{ showAvatarFrame: true, showNameplate: true }}
            />
        );

        expect(traveling).toContain(
            'data-avatar-frame="invt_frame" data-active="true"'
        );
        expect(settled).toContain(
            'data-avatar-frame="invt_frame" data-active="false"'
        );
        expect(traveling).toContain(
            'data-nameplate="invt_plate" data-active="true"'
        );
        expect(settled).toContain(
            'data-nameplate="invt_plate" data-active="false"'
        );
    });
});
