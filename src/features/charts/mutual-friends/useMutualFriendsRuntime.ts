import { getResolvedThemeMode } from '@/services/themeService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

export function useMutualFriendsRuntime() {
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state: any) => state.orderedFriendIds
    );
    const shellThemeMode = useShellStore((state: any) => state.themeMode);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);

    return {
        currentUserId,
        currentUserEndpoint,
        friendsById,
        orderedFriendIds,
        resolvedTheme
    };
}
