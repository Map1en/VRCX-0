// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { usePreferencesStore } from '@/state/preferencesStore';
import { onlinePresence, travelingPresence } from '@/test/presenceFixtures';

import { FriendsLocationsFriendChips } from './FriendsLocationsWorldSection';

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: { children: ReactNode }) => children
}));
vi.mock('@/services/entityMediaService', () => ({ userImage: () => '' }));
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

const friend: FriendRecord = {
    id: 'usr_friend',
    displayName: 'Friend',
    iconFrame: 'invt_frame',
    nameplateEffect: 'invt_plate',
    tags: [],
    $presence: onlinePresence('wrld_test:123'),
    $trustLevel: '',
    $friendNumber: 0,
    $trustClass: '',
    $trustSortNum: 0,
    $isModerator: false,
    $isTroll: false,
    $isProbableTroll: false,
    $platform: ''
};

function renderChips(chipFriend: FriendRecord = friend) {
    return render(
        <FriendsLocationsFriendChips
            friends={[chipFriend]}
            favoriteIds={new Set()}
            twoLine={false}
            onOpenUser={vi.fn()}
        />
    ).container.innerHTML;
}

describe('FriendsLocationsFriendChips profile decorations', () => {
    afterEach(() => {
        cleanup();
        usePreferencesStore.setState({
            showFriendsLocationsWorldsAvatarFrame: true,
            showFriendsLocationsWorldsNameplate: true
        });
    });

    it('shows the avatar frame and nameplate by default', () => {
        const html = renderChips();
        expect(html).toContain('data-avatar-frame="invt_frame"');
        expect(html).toContain('data-nameplate="invt_plate"');
    });

    it('follows the worlds view decoration preferences independently', () => {
        usePreferencesStore.setState({
            showFriendsLocationsWorldsNameplate: false
        });
        const frameOnly = renderChips();
        cleanup();
        expect(frameOnly).toContain('data-avatar-frame="invt_frame"');
        expect(frameOnly).not.toContain('data-nameplate');

        usePreferencesStore.setState({
            showFriendsLocationsWorldsAvatarFrame: false,
            showFriendsLocationsWorldsNameplate: true
        });
        const nameplateOnly = renderChips();
        expect(nameplateOnly).not.toContain('data-avatar-frame');
        expect(nameplateOnly).toContain('data-nameplate="invt_plate"');
    });
});

describe('FriendsLocationsFriendChips traveling', () => {
    afterEach(cleanup);

    it('shows the spinner and lights the avatar frame and nameplate until the friend lands', () => {
        const traveling = renderChips({
            ...friend,
            $presence: travelingPresence('wrld_next:1')
        });
        cleanup();
        const landed = renderChips({
            ...friend,
            $presence: onlinePresence('wrld_next:1')
        });

        expect(traveling).toContain('data-slot="spinner"');
        expect(traveling).toContain(
            'data-avatar-frame="invt_frame" data-active="true"'
        );
        expect(traveling).toContain(
            'data-nameplate="invt_plate" data-active="true"'
        );
        expect(landed).not.toContain('data-slot="spinner"');
        expect(landed).toContain(
            'data-avatar-frame="invt_frame" data-active="false"'
        );
        expect(landed).toContain(
            'data-nameplate="invt_plate" data-active="false"'
        );
    });
});
