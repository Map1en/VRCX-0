import { useMemo } from 'react';

import { usePreferencesStore } from '@/state/preferencesStore';

const NO_USER_IDS: string[] = [];

export function useFeedHiddenUserFilters() {
    const feedHiddenUsers = usePreferencesStore(
        (state) => state.feedHiddenUsers
    );
    const hideAll = usePreferencesStore(
        (state) => state.feedHiddenUsersHideAll
    );
    return useMemo(
        () =>
            hideAll
                ? {
                      excludedUserIds: feedHiddenUsers,
                      locationHiddenUserIds: NO_USER_IDS
                  }
                : {
                      excludedUserIds: NO_USER_IDS,
                      locationHiddenUserIds: feedHiddenUsers
                  },
        [feedHiddenUsers, hideAll]
    );
}
