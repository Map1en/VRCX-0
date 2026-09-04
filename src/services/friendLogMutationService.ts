import { useFriendLogStore } from '@/state/friendLogStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

export function signalFriendLogChanged() {
    useFriendLogStore.getState().bumpRevision();
    if (usePreferencesStore.getState().friendLogNotificationDot) {
        useShellStore.getState().notifyMenu('friend-log');
    }
}
