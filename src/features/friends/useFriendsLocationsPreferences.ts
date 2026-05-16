// @ts-nocheck
import { useEffect, useState } from 'react';

import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import { configRepository } from '@/repositories/index.js';

import { parseConfigArray } from './friendsLocationsConfig.js';
import {
    DEFAULT_FRIENDS_LOCATIONS_DENSITY,
    sanitizeFriendsLocationsDensity
} from './friendsLocationsDensity.js';

export function useFriendsLocationsPreferences() {
    const [showSameInstance, setShowSameInstance] = useState(false);
    const [density, setDensity] = useState(DEFAULT_FRIENDS_LOCATIONS_DENSITY);
    const [sidebarFavoritePrefs, setSidebarFavoritePrefs] = useState({
        isDivideByGroup: false,
        selectedGroups: [],
        groupOrder: []
    });
    const [sidebarSortMethods, setSidebarSortMethods] = useState([
        'Sort by Status',
        'Sort Alphabetically',
        ''
    ]);

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getString(
                'FriendLocationDensity',
                DEFAULT_FRIENDS_LOCATIONS_DENSITY
            ),
            configRepository.getBool('FriendLocationShowSameInstance', false),
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
                    nextDensity,
                    nextShowSameInstance,
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

                    setDensity(sanitizeFriendsLocationsDensity(nextDensity));
                    setShowSameInstance(Boolean(nextShowSameInstance));
                    setSidebarFavoritePrefs({
                        isDivideByGroup: Boolean(nextDivideByGroup),
                        selectedGroups: parseConfigArray(nextSelectedGroups),
                        groupOrder: parseConfigArray(nextGroupOrder)
                    });
                    setSidebarSortMethods([
                        nextSortMethod1 || '',
                        nextSortMethod2 || '',
                        nextSortMethod3 || ''
                    ]);
                }
            )
            .catch(() => {});

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
                            isDivideByGroup: Boolean(nextDivideByGroup),
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
                    // ignore preference refresh failures
                }
            }
        );

        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    function changeShowSameInstance(value) {
        const nextValue = Boolean(value);
        setShowSameInstance(nextValue);
        void configRepository.setBool(
            'FriendLocationShowSameInstance',
            nextValue
        );
    }

    function changeDensityPreference(value) {
        const nextValue = sanitizeFriendsLocationsDensity(value);
        setDensity(nextValue);
        void configRepository.setString('FriendLocationDensity', nextValue);
    }

    return {
        changeDensityPreference,
        changeShowSameInstance,
        density,
        showSameInstance,
        sidebarFavoritePrefs,
        sidebarSortMethods
    };
}
