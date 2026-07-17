import { useFriendLogStore } from '@/state/friendLogStore';
import { useShellStore } from '@/state/shellStore';

export function signalFriendLogChanged() {
    useFriendLogStore.getState().bumpRevision();
    useShellStore.getState().notifyMenu('friend-log');
}
