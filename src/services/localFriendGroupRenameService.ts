import configRepository from '@/repositories/configRepository';
import { setLocalFavoriteFriendsGroupsPreference } from '@/services/preferencesService';
import {
    hydrateSidebarTabLayout,
    saveSidebarTabLayout
} from '@/services/sidebarTabService';
import { publishPreferenceChanged } from '@/shared/events/preferenceEvents';
import { safeJsonParse } from '@/shared/utils/json';
import { isRecord } from '@/shared/utils/record';
import { normalizeSidebarTabLayout } from '@/shared/utils/sidebarTabLayout';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useSidebarTabStore } from '@/state/sidebarTabStore';

function renameStrings(value: unknown, from: string, to: string): unknown {
    if (value === from) {
        return to;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => renameStrings(entry, from, to));
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
                key,
                renameStrings(entry, from, to)
            ])
        );
    }
    return value;
}

async function renameStoredJson(key: string, from: string, to: string) {
    const stored = safeJsonParse(await configRepository.getString(key, '[]'));
    const renamed = renameStrings(stored, from, to);
    if (JSON.stringify(renamed) === JSON.stringify(stored)) {
        return null;
    }
    await configRepository.setString(key, JSON.stringify(renamed));
    return renamed;
}

export async function renameLocalFriendGroupReferences(
    groupName: string,
    newGroupName: string
) {
    const from = `local:${groupName}`;
    const to = `local:${newGroupName}`;

    const favoriteFriendsGroups =
        usePreferencesStore.getState().localFavoriteFriendsGroups;
    if (favoriteFriendsGroups.includes(from)) {
        await setLocalFavoriteFriendsGroupsPreference(
            favoriteFriendsGroups.map((key) => (key === from ? to : key))
        );
    }

    for (const key of ['sidebarFavoriteGroups', 'sidebarFavoriteGroupOrder']) {
        const renamed = await renameStoredJson(key, from, to);
        if (Array.isArray(renamed)) {
            publishPreferenceChanged(key, renamed);
        }
    }
    await renameStoredJson('autoAcceptInviteGroups', from, to);
    await renameStoredJson('feedColumnsConfig', from, to);

    await hydrateSidebarTabLayout();
    const tabLayout = useSidebarTabStore.getState().tabLayout;
    const renamedLayout = renameStrings(tabLayout, from, to);
    if (JSON.stringify(renamedLayout) !== JSON.stringify(tabLayout)) {
        await saveSidebarTabLayout(normalizeSidebarTabLayout(renamedLayout));
    }
}
