import { useMemo } from 'react';

import { getResolvedThemeMode } from '@/services/themeService';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';

export function useInstanceActivityRuntime(userIdOverride = '') {
    const authUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const favoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavoritesList = useFavoriteStore(
        (state) => state.localFriendFavoritesList
    );
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const hour12 = usePreferencesStore((state) => state.dtHour12);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);
    const friendIdSet = useMemo(
        () => new Set(Object.keys(friendsById)),
        [friendsById]
    );
    const favoriteIdSet = useMemo(
        () =>
            new Set([
                ...(favoriteFriendIds || []),
                ...(localFriendFavoritesList || [])
            ]),
        [favoriteFriendIds, localFriendFavoritesList]
    );

    return {
        currentEndpoint,
        currentUserId: userIdOverride || authUserId,
        favoriteIdSet,
        friendIdSet,
        hour12,
        resolvedTheme
    };
}
