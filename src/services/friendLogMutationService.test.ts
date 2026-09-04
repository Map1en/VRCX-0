import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bumpRevision: vi.fn(),
    friendLogNotificationDot: true,
    notifyMenu: vi.fn()
}));

vi.mock('@/state/friendLogStore', () => ({
    useFriendLogStore: {
        getState: () => ({ bumpRevision: mocks.bumpRevision })
    }
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: {
        getState: () => ({
            friendLogNotificationDot: mocks.friendLogNotificationDot
        })
    }
}));

vi.mock('@/state/shellStore', () => ({
    useShellStore: {
        getState: () => ({ notifyMenu: mocks.notifyMenu })
    }
}));

import { signalFriendLogChanged } from './friendLogMutationService';

describe('signalFriendLogChanged', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.friendLogNotificationDot = true;
    });

    it('shows the Friend Log notification dot by default', () => {
        signalFriendLogChanged();

        expect(mocks.bumpRevision).toHaveBeenCalledOnce();
        expect(mocks.notifyMenu).toHaveBeenCalledWith('friend-log');
    });

    it('keeps the Friend Log fresh without showing a dot when disabled', () => {
        mocks.friendLogNotificationDot = false;

        signalFriendLogChanged();

        expect(mocks.bumpRevision).toHaveBeenCalledOnce();
        expect(mocks.notifyMenu).not.toHaveBeenCalled();
    });
});
