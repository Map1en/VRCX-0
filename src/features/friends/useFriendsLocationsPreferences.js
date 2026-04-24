import { useEffect, useState } from 'react';

import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import { configRepository } from '@/repositories/index.js';

import { parseConfigArray } from './friendsLocationsConfig.js';

function formatOptionValue(value) {
    return Number(value)
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
}

function parseScale(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampScale(value, min, max, fallback) {
    const parsed = parseScale(value, fallback);
    return Math.min(max, Math.max(min, parsed));
}

export function useFriendsLocationsPreferences() {
    const [showSameInstance, setShowSameInstance] = useState(false);
    const [cardScale, setCardScale] = useState(1);
    const [spacingScale, setSpacingScale] = useState(1);
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
            configRepository.getString('FriendLocationCardScale', '1'),
            configRepository.getString('FriendLocationCardSpacing', '1'),
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
                    nextScale,
                    nextSpacing,
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

                    setCardScale(clampScale(nextScale, 0.5, 1, 1));
                    setSpacingScale(clampScale(nextSpacing, 0.25, 1, 1));
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
        void configRepository.setBool('FriendLocationShowSameInstance', nextValue);
    }

    function changeCardScalePreference(value) {
        const nextValue = clampScale(value, 0.5, 1, 1);
        setCardScale(nextValue);
        void configRepository.setString(
            'FriendLocationCardScale',
            formatOptionValue(nextValue)
        );
    }

    function changeSpacingScalePreference(value) {
        const nextValue = clampScale(value, 0.25, 1, 1);
        setSpacingScale(nextValue);
        void configRepository.setString(
            'FriendLocationCardSpacing',
            formatOptionValue(nextValue)
        );
    }

    return {
        cardScale,
        changeCardScalePreference,
        changeShowSameInstance,
        changeSpacingScalePreference,
        showSameInstance,
        sidebarFavoritePrefs,
        sidebarSortMethods,
        spacingScale
    };
}
