import type { BuildSettingsPageStateSectionsInput } from '../settingsPageStateSections';
import { normalizeCheckedState } from '../settingsValues';

export function buildSocialSection({
    prefs,
    selectedFavoriteFriendGroupLabel,
    favoriteFriendGroupOptions,
    remoteFavoriteFriendGroupOptions,
    localFavoriteFriendGroupOptions,
    localFavoriteFriendsGroups,
    commit,
    addFeedHiddenUser,
    removeFeedHiddenUser,
    setRecentActionCooldownEnabledPreference,
    setRecentActionCooldownMinutesPreference,
    toggleLocalFavoriteFriendsGroup,
    setPrefs,
    saveBoolPreference,
    savePreferenceValue,
    normalizeRecentActionCooldownMinutes
}: BuildSettingsPageStateSectionsInput) {
    return {
        prefs,
        selectedFavoriteFriendGroupLabel,
        favoriteFriendGroupOptions,
        remoteFavoriteFriendGroupOptions,
        localFavoriteFriendGroupOptions,
        localFavoriteFriendsGroups,
        feedHiddenUsers: prefs.feedHiddenUsers,
        commit,
        onAddFeedHiddenUser: addFeedHiddenUser,
        onRemoveFeedHiddenUser: removeFeedHiddenUser,
        setRecentActionCooldownEnabledPreference,
        setRecentActionCooldownMinutesPreference,
        toggleLocalFavoriteFriendsGroup,
        setPrefs,
        onHideUnfriendsChange: (checked: unknown) => {
            saveBoolPreference(
                'hideUnfriends',
                'hideUnfriends',
                normalizeCheckedState(checked)
            );
        },
        onRecentActionCooldownEnabledChange: (checked: unknown) => {
            const enabled = normalizeCheckedState(checked);
            savePreferenceValue('recentActionCooldownEnabled', enabled, () =>
                setRecentActionCooldownEnabledPreference(enabled)
            );
        },
        onRecentActionCooldownMinutesChange: (value: unknown) => {
            setPrefs((current) => ({
                ...current,
                recentActionCooldownMinutes: value
            }));
        },
        onRecentActionCooldownMinutesBlur: (value: unknown) => {
            const nextValue = normalizeRecentActionCooldownMinutes(value);
            savePreferenceValue('recentActionCooldownMinutes', nextValue, () =>
                setRecentActionCooldownMinutesPreference(nextValue)
            );
        },
        onToggleLocalFavoriteFriendsGroup: (
            groupKey: unknown,
            checked: unknown
        ) => {
            toggleLocalFavoriteFriendsGroup(
                groupKey,
                normalizeCheckedState(checked)
            );
        }
    };
}
