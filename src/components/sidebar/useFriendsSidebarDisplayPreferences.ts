import { usePreferencesStore } from '@/state/preferencesStore';

export function useFriendsSidebarDisplayPreferences() {
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const trustColor = usePreferencesStore((state) => state.trustColor);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const ageGatedInstancesVisiblePreference = usePreferencesStore(
        (state) => state.isAgeGatedInstancesVisible
    );
    const showInstanceIdInLocation = usePreferencesStore(
        (state) => state.showInstanceIdInLocation
    );
    const ageGatedInstancesVisible =
        preferencesHydrated && ageGatedInstancesVisiblePreference;

    return {
        ageGatedInstancesVisible,
        randomUserColours,
        showInstanceIdInLocation,
        trustColor
    };
}
