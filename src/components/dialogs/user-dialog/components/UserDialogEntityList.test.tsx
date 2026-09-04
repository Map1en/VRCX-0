// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

const mocks = vi.hoisted(() => ({
    getGroupProfile: vi.fn(),
    openRow: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            if (key === 'dialog.user.mutual_friends.undisclosed_friend') {
                return 'Localized Undisclosed Mutual Friend';
            }
            if (key === 'common.error.failed_to_load_data') {
                return "Couldn't load the data";
            }
            return key;
        }
    })
}));

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({
        children,
        disabled
    }: {
        children: ReactNode;
        disabled?: boolean;
    }) => <div data-hover-disabled={String(Boolean(disabled))}>{children}</div>
}));

vi.mock('@/components/UserStatusAvatar', () => ({
    UserStatusAvatar: () => <span />
}));

vi.mock('@/components/sidebar/friends-sidebar/friendsSidebarModel', () => ({
    resolveSidebarStatusDotClassName: () => ''
}));

vi.mock('@/services/entityMediaService', () => ({
    convertFileUrlToImageUrl: () => '',
    userImage: () => ''
}));

vi.mock('@/repositories/groupProfileRepository', () => ({
    default: {
        getGroupProfile: mocks.getGroupProfile
    }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserEndpoint: string;
                currentUserSnapshot: null;
            };
            gameState: { isGameRunning: boolean };
        }) => T
    ): T =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.vrchat.cloud',
                currentUserSnapshot: null
            },
            gameState: { isGameRunning: false }
        })
}));

vi.mock('./userDialogEntityNavigation', () => ({
    openRow: mocks.openRow
}));

import { EntityList } from './UserDialogEntityList';

describe('UserDialog EntityList', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_600_000);
        useFriendRosterStore.getState().resetRoster();
        useFriendLocationTimeStore.getState().reset();
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('replaces internal Tauri command errors with a friendly message', () => {
        render(
            <EntityList
                kind="user"
                rows={[]}
                error="Tauri command failed: app__user_mutual_friends_list_get: network request failed"
            />
        );

        expect(screen.getByText("Couldn't load the data")).toBeTruthy();
        expect(screen.queryByText(/Tauri command failed/)).toBeNull();
    });

    it('localizes undisclosed mutual friends and prevents opening them', () => {
        render(
            <EntityList
                kind="user"
                rows={[
                    {
                        id: 'usr_00000000-0000-0000-0000-000000000000',
                        displayName: 'Hidden Mutual'
                    },
                    {
                        id: 'usr_visible',
                        displayName: 'Visible Friend'
                    }
                ]}
            />
        );

        const undisclosedButton = screen.getByRole('button', {
            name: 'Localized Undisclosed Mutual Friend'
        });
        const visibleButton = screen.getByRole('button', {
            name: 'Visible Friend'
        });

        expect(undisclosedButton).toHaveProperty('disabled', true);
        expect(
            undisclosedButton.parentElement?.getAttribute('data-hover-disabled')
        ).toBe('true');
        fireEvent.click(undisclosedButton);
        expect(mocks.openRow).not.toHaveBeenCalled();

        fireEvent.click(visibleButton);
        expect(mocks.openRow).toHaveBeenCalledTimes(1);
    });

    it('shows the instance timer instead of the status signature', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                displayName: 'Friend',
                state: 'online',
                location: 'wrld_test:1'
            },
            stateBucketAuthority: 'explicit'
        });
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend',
                location: 'wrld_test:1',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        ]);
        render(
            <EntityList
                kind="user"
                rows={[
                    {
                        id: 'usr_friend',
                        displayName: 'Friend',
                        state: 'online',
                        location: 'wrld_test:1',
                        statusDescription: 'World hopping'
                    }
                ]}
                showInstanceDuration
            />
        );

        expect(screen.getByText('10m')).toBeTruthy();
        expect(screen.queryByText('World hopping')).toBeNull();
    });

    it('uses the displayed instance for an online friend with a hidden presence location', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                displayName: 'Friend',
                state: 'online',
                location: 'private'
            },
            stateBucketAuthority: 'explicit'
        });
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend',
                location: 'wrld_test:1',
                source: 'realtime',
                sinceMs: 1_700_000_000_000
            }
        ]);
        render(
            <EntityList
                kind="user"
                rows={[
                    {
                        id: 'usr_friend',
                        displayName: 'Friend',
                        state: 'online',
                        location: 'private',
                        statusDescription: 'Do not disturb'
                    }
                ]}
                instanceLocation="wrld_test:1"
                showInstanceDuration
            />
        );

        expect(screen.getByText('10m')).toBeTruthy();
        expect(screen.queryByText('Do not disturb')).toBeNull();
    });

    it('shows a creator icon and label without a timer for a friend creator', () => {
        render(
            <EntityList
                kind="user"
                rows={[
                    {
                        id: 'usr_owner',
                        displayName: 'Friend owner',
                        isFriend: true,
                        $isInstanceCreator: true,
                        $subtitle: 'dialog.user.info.instance_creator',
                        statusDescription: 'Friend signature',
                        $location_at: 1_700_000_000_000
                    }
                ]}
                showInstanceDuration
            />
        );

        expect(
            screen.getByLabelText('dialog.user.info.instance_creator')
        ).toBeTruthy();
        expect(
            screen.getByText('dialog.user.info.instance_creator')
        ).toBeTruthy();
        expect(screen.queryByTestId('instance-timer')).toBeNull();
        expect(screen.queryByText('Friend signature')).toBeNull();
    });

    it('shows a creator icon and label for a non-friend creator', () => {
        render(
            <EntityList
                kind="user"
                rows={[
                    {
                        id: 'usr_owner',
                        displayName: 'Remote owner',
                        isFriend: false,
                        $isInstanceCreator: true,
                        statusDescription: 'Owner signature',
                        $location_at: 1_700_000_000_000
                    }
                ]}
                showInstanceDuration
            />
        );

        expect(
            screen.getByLabelText('dialog.user.info.instance_creator')
        ).toBeTruthy();
        expect(
            screen.getByText('dialog.user.info.instance_creator')
        ).toBeTruthy();
        expect(screen.queryByText('Owner signature')).toBeNull();
        expect(screen.queryByTestId('instance-timer')).toBeNull();
    });

    it('keeps the Creator label when a non-friend creator has no signature', () => {
        render(
            <EntityList
                kind="user"
                rows={[
                    {
                        id: 'usr_owner',
                        displayName: 'Offline owner',
                        isFriend: false,
                        $isInstanceCreator: true,
                        statusDescription: '',
                        state: 'offline'
                    }
                ]}
                showInstanceDuration
            />
        );

        expect(
            screen.getByText('dialog.user.info.instance_creator')
        ).toBeTruthy();
        expect(screen.queryByText('dialog.user.status.offline')).toBeNull();
        expect(screen.queryByTestId('instance-timer')).toBeNull();
    });

    it('does not treat a profile refresh timestamp as a join time', () => {
        render(
            <EntityList
                kind="user"
                rows={[
                    {
                        id: 'usr_friend',
                        displayName: 'Friend',
                        statusDescription: 'No dwell time',
                        locationUpdatedAt: 1_700_000_000_000
                    }
                ]}
                showInstanceDuration
            />
        );

        expect(screen.getByText('No dwell time')).toBeTruthy();
        expect(screen.queryByText('10m')).toBeNull();
    });

    it('renders group list data without requesting every group profile', () => {
        render(
            <EntityList
                kind="group"
                rows={[
                    {
                        id: 'grp_test',
                        name: 'Group from membership list',
                        memberCount: 42
                    }
                ]}
            />
        );

        expect(screen.getByText('Group from membership list')).toBeTruthy();
        expect(screen.getByText('42')).toBeTruthy();
        expect(mocks.getGroupProfile).not.toHaveBeenCalled();
    });
});
