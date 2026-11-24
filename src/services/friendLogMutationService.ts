import { notifyShellMenu } from '@/services/shellNotificationDotService';
import { useFriendLogStore } from '@/state/friendLogStore';
import { usePreferencesStore } from '@/state/preferencesStore';

export function signalFriendLogChanged() {
    useFriendLogStore.getState().bumpRevision();
    if (usePreferencesStore.getState().friendLogNotificationDot) {
        notifyShellMenu('friend-log');
    }
}
