// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => {}
    },
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn(),
    openWorldDialog: vi.fn()
}));

vi.mock('./useUserHoverCardData', () => ({
    useUserHoverCardData: () => ({
        model: {
            variant: 'profile-only',
            displayName: 'Alice',
            avatarUrl: '',
            avatarPreviewUrl: '',
            userColour: '',
            trustSource: {},
            trustKey: '',
            statusKey: '',
            statusDotClassName: '',
            statusDescription: '',
            note: '',
            decorations: {
                iconFrame: '',
                profileEffect: '',
                nameplateEffect: ''
            },
            onlineForMs: 0,
            instanceEpoch: 0,
            lastOnlineAgoMs: 0,
            location: {
                effectiveLocation: '',
                worldId: '',
                instanceId: '',
                tag: '',
                accessTypeName: '',
                isRealInstance: false,
                isTraveling: false
            }
        },
        worldThumb: '',
        population: null,
        populationLoading: false,
        memo: '',
        trustColor: false,
        instanceEpoch: 0,
        profile: null,
        relationshipBadges: [],
        hasSeed: true,
        loading: false,
        loadFailed: false
    })
}));

vi.mock('./UserHoverCardMutuals', () => ({
    UserHoverCardMutuals: ({ userId }: { userId: string }) => (
        <div data-testid="mutuals">{userId}</div>
    )
}));

import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { UserHoverCardContent } from './UserHoverCardContent';

describe('UserHoverCardContent mutual friends', () => {
    beforeEach(() => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: '',
            currentUserWebsocket: '',
            currentUserSnapshot: { id: 'usr_self' }
        });
        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    stateBucket: 'offline'
                }
            }
        });
    });

    afterEach(() => {
        cleanup();
        useFriendRosterStore.getState().resetRoster();
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('shows mutual friends for a player who is not a friend', () => {
        render(<UserHoverCardContent userId="usr_stranger" />);

        expect(screen.getByTestId('mutuals').textContent).toBe('usr_stranger');
    });

    it('leaves mutual friends out for friends and the current user', () => {
        render(<UserHoverCardContent userId="usr_friend" />);
        render(<UserHoverCardContent userId="usr_self" />);

        expect(screen.queryByTestId('mutuals')).toBeNull();
    });
});
