import { useEffect, useState } from 'react';

import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';
import configRepository from '@/repositories/configRepository';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';

import { parseConfigArray } from './friendsLocationsConfig';
import {
    DEFAULT_FRIENDS_LOCATIONS_DENSITY,
    sanitizeFriendsLocationsDensity,
    type FriendsLocationsDensity
} from './friendsLocationsDensity';
import {
    DEFAULT_FRIENDS_LOCATIONS_VIEW_MODE,
    sanitizeFriendsLocationsViewMode,
    type FriendsLocationsViewMode
} from './friendsLocationsWorlds';

type FriendsLocationsSidebarFavoritePrefs = {
    isDivideByGroup: boolean;
    selectedGroups: string[];
    groupOrder: string[];
};

export function useFriendsLocationsPreferences() {
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [showSameInstanceInOnline, setShowSameInstanceInOnline] =
        useState(true);
    const [showFavoritesInOnline, setShowFavoritesInOnline] = useState(true);
    const [density, setDensity] = useState<FriendsLocationsDensity>(() =>
        sanitizeFriendsLocationsDensity(
            readStoredText(STORAGE_KEYS.friendLocationDensity) ??
                DEFAULT_FRIENDS_LOCATIONS_DENSITY
        )
    );
    const [viewMode, setViewMode] = useState<FriendsLocationsViewMode>(() =>
        sanitizeFriendsLocationsViewMode(
            configRepository.getCachedString(
                'FriendLocationViewMode',
                DEFAULT_FRIENDS_LOCATIONS_VIEW_MODE
            )
        )
    );
    const [sidebarFavoritePrefs, setSidebarFavoritePrefs] =
        useState<FriendsLocationsSidebarFavoritePrefs>({
            isDivideByGroup: false,
            selectedGroups: [],
            groupOrder: []
        });
    const [sidebarSortMethods, setSidebarSortMethods] = useState<string[]>([
        'Sort by Status',
        'Sort Alphabetically',
        ''
    ]);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getBool('FriendLocationShowSameInstance', true),
            configRepository.getBool(
                'FriendLocationShowFavoritesInOnline',
                true
            ),
            configRepository.getString(
                'FriendLocationViewMode',
                DEFAULT_FRIENDS_LOCATIONS_VIEW_MODE
            ),
            configRepository.getBool('isSidebarDivideByFriendGroup', false),
            configRepository.getString('sidebarFavoriteGroups', '[]'),
            configRepository.getString('sidebarFavoriteGroupOrder', '[]'),
            configRepository.getString('sidebarSortMethod1', 'Sort by Status'),
            configRepository.getString(
                'sidebarSortMethod2',
                'Sort Alphabetically'
            ),
            configRepository.getString('sidebarSortMethod3', '')
        ])
            .then(
                ([
                    nextShowSameInstance,
                    nextShowFavorites,
                    nextViewMode,
                    nextDivideByGroup,
                    nextSelectedGroups,
                    nextGroupOrder,
                    nextSortMethod1,
                    nextSortMethod2,
                    nextSortMethod3
                ]) => {
                    if (!active) {
                        return;
                    }

                    setShowSameInstanceInOnline(nextShowSameInstance);
                    setShowFavoritesInOnline(nextShowFavorites);
                    setViewMode(sanitizeFriendsLocationsViewMode(nextViewMode));
                    setSidebarFavoritePrefs({
                        isDivideByGroup: nextDivideByGroup,
                        selectedGroups: parseConfigArray(nextSelectedGroups),
                        groupOrder: parseConfigArray(nextGroupOrder)
                    });
                    setSidebarSortMethods([
                        nextSortMethod1 || '',
                        nextSortMethod2 || '',
                        nextSortMethod3 || ''
                    ]);
                    setPreferencesReady(true);
                }
            )
            .catch(() => {
                if (active) {
                    setPreferencesReady(true);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const unsubscribe = onPreferenceChanged(
            [
                'isSidebarDivideByFriendGroup',
                'sidebarFavoriteGroups',
                'sidebarFavoriteGroupOrder',
                'sidebarSortMethod1',
                'sidebarSortMethod2',
                'sidebarSortMethod3'
            ],
            async () => {
                try {
                    const [
                        nextDivideByGroup,
                        nextSelectedGroups,
                        nextGroupOrder,
                        nextSortMethod1,
                        nextSortMethod2,
                        nextSortMethod3
                    ] = await Promise.all([
                        configRepository.getBool(
                            'isSidebarDivideByFriendGroup',
                            false
                        ),
                        configRepository.getString(
                            'sidebarFavoriteGroups',
                            '[]'
                        ),
                        configRepository.getString(
                            'sidebarFavoriteGroupOrder',
                            '[]'
                        ),
                        configRepository.getString(
                            'sidebarSortMethod1',
                            'Sort by Status'
                        ),
                        configRepository.getString(
                            'sidebarSortMethod2',
                            'Sort Alphabetically'
                        ),
                        configRepository.getString('sidebarSortMethod3', '')
                    ]);
                    if (active) {
                        setSidebarFavoritePrefs({
                            isDivideByGroup: nextDivideByGroup,
                            selectedGroups:
                                parseConfigArray(nextSelectedGroups),
                            groupOrder: parseConfigArray(nextGroupOrder)
                        });
                        setSidebarSortMethods([
                            nextSortMethod1 || '',
                            nextSortMethod2 || '',
                            nextSortMethod3 || ''
                        ]);
                    }
                } catch {
                    // no-op
                }
            }
        );

        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    function changeShowSameInstanceInOnline(value: boolean) {
        setShowSameInstanceInOnline(value);
        configRepository.setBool('FriendLocationShowSameInstance', value);
    }

    function changeShowFavoritesInOnline(value: boolean) {
        setShowFavoritesInOnline(value);
        configRepository.setBool('FriendLocationShowFavoritesInOnline', value);
    }

    function changeDensityPreference(value: FriendsLocationsDensity) {
        setDensity(value);
        writeStoredText(STORAGE_KEYS.friendLocationDensity, value);
    }

    function changeViewMode(value: FriendsLocationsViewMode) {
        setViewMode(value);
        configRepository.setString('FriendLocationViewMode', value);
    }

    return {
        changeDensityPreference,
        changeShowFavoritesInOnline,
        changeShowSameInstanceInOnline,
        changeViewMode,
        density,
        preferencesReady,
        showFavoritesInOnline,
        showSameInstanceInOnline,
        sidebarFavoritePrefs,
        sidebarSortMethods,
        viewMode
    };
}
