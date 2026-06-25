import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS } from '@/repositories/avatarSearchProviderRepository';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import configRepository from '@/repositories/configRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';

import { resolveTabValue } from './userDialogRows';
import {
    isUserDialogDataTab,
    loadUserDialogTabData,
    loadUserDialogTabCounts,
    userDialogDataKeyForTab
} from './userDialogTabService';
import { buildUserDialogListViewData } from './userDialogViewData';

const userDialogTabServiceRepositories = Object.freeze({
    avatarSearchProviderRepository,
    groupProfileRepository,
    myAvatarRepository,
    userProfileRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
});

let lastUserDialogTab = 'info';

const emptyUserDialogRemoteData = Object.freeze({
    groups: Object.freeze([]),
    mutual: Object.freeze([]),
    worlds: Object.freeze([]),
    favoriteWorldGroups: Object.freeze([]),
    favoriteWorlds: Object.freeze([]),
    avatars: Object.freeze([])
});

const emptyUserDialogStatus = Object.freeze({});

const emptyUserDialogSearch = Object.freeze({
    mutual: '',
    groups: '',
    worlds: '',
    favoriteWorlds: '',
    avatars: ''
});

const USER_DIALOG_AVATAR_SORT_CONFIG_KEY = 'UserDialogAvatarSort';
const userDialogAvatarSortValues = new Set(['name', 'update', 'createdAt']);

function normalizeUserDialogAvatarSort(value: any) {
    const normalizedValue = String(value ?? '').trim();
    return userDialogAvatarSortValues.has(normalizedValue)
        ? normalizedValue
        : 'name';
}

function emptyDataPatchForTab(tab: any): Record<string, unknown[]> {
    const dataKey = userDialogDataKeyForTab(tab);
    if (!dataKey) {
        return {};
    }
    return {
        [dataKey]: [],
        ...(tab === 'favorite-worlds' ? { favoriteWorldGroups: [] } : {})
    };
}

function visibleTabs(tabs: any) {
    return tabs.filter((tab: any) => !tab.hidden);
}

export function useUserDialogTabData({
    profile,
    reloadToken,
    isCurrentUser,
    currentEndpoint,
    currentUserId,
    currentAvatarId = '',
    previousAvatarSwapTime = 0,
    currentUserHasSharedConnectionsOptOut,
    friendsById,
    inGameGroupOrder,
    selectedGroupIds,
    t
}: any) {
    const [activeTab, setActiveTab] = useState('info');
    const [remoteData, setRemoteData] = useState<any>(
        emptyUserDialogRemoteData
    );
    const [remoteStatus, setRemoteStatus] = useState<any>(
        emptyUserDialogStatus
    );
    const [remoteErrors, setRemoteErrors] = useState<any>(
        emptyUserDialogStatus
    );
    const [remoteTabCounts, setRemoteTabCounts] = useState<any>(
        emptyUserDialogStatus
    );
    const [search, setSearch] = useState(emptyUserDialogSearch);
    const [worldSort, setWorldSort] = useState('updated');
    const [worldOrder, setWorldOrder] = useState('descending');
    const [avatarSort, setAvatarSort] = useState('name');
    const [avatarReleaseStatus, setAvatarReleaseStatus] = useState('all');
    const [mutualSort, setMutualSort] = useState('alphabetical');
    const [groupSort, setGroupSort] = useState(
        isCurrentUser ? 'inGame' : 'alphabetical'
    );
    const [vrchatConfigConstants, setVrchatConfigConstants] = useState(null);
    const effectiveAvatarReleaseStatus =
        profile.id === currentUserId ? avatarReleaseStatus : 'all';
    const loadContextRef = useRef<any>({
        endpoint: currentEndpoint,
        userId: profile.id,
        reloadToken
    });
    const countContextRef = useRef<any>({
        endpoint: currentEndpoint,
        userId: profile.id,
        currentUserId,
        currentAvatarId,
        previousAvatarSwapTime,
        avatarReleaseStatus: effectiveAvatarReleaseStatus,
        reloadToken
    });
    const avatarSortLoadVersionRef = useRef(0);
    const handledReloadTokenRef = useRef(reloadToken);
    const handledCountReloadTokenRef = useRef(reloadToken);
    countContextRef.current = {
        endpoint: currentEndpoint,
        userId: profile.id,
        currentUserId,
        currentAvatarId,
        previousAvatarSwapTime,
        avatarReleaseStatus: effectiveAvatarReleaseStatus,
        reloadToken
    };

    const viewData = useMemo(
        () =>
            buildUserDialogListViewData({
                profile,
                remoteData,
                remoteStatus,
                friendsById,
                search,
                mutualSort,
                groupSort,
                isCurrentUser,
                inGameGroupOrder,
                selectedGroupIds,
                effectiveAvatarReleaseStatus,
                avatarSort,
                currentUserHasSharedConnectionsOptOut,
                t
            }),
        [
            avatarSort,
            currentUserHasSharedConnectionsOptOut,
            effectiveAvatarReleaseStatus,
            friendsById,
            groupSort,
            inGameGroupOrder,
            isCurrentUser,
            mutualSort,
            profile,
            remoteData,
            remoteStatus,
            search,
            selectedGroupIds,
            t
        ]
    );

    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            worldSort,
            worldOrder,
            avatarSort,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteData(emptyUserDialogRemoteData);
        setRemoteStatus(emptyUserDialogStatus);
        setRemoteErrors(emptyUserDialogStatus);
        setRemoteTabCounts(emptyUserDialogStatus);
        setSearch(emptyUserDialogSearch);
        const nextTab = resolveTabValue(
            visibleTabs(viewData.tabs),
            lastUserDialogTab
        );
        lastUserDialogTab = nextTab;
        setActiveTab(nextTab);
    }, [
        currentEndpoint,
        currentUserHasSharedConnectionsOptOut,
        isCurrentUser,
        profile.id,
        reloadToken
    ]);

    useLayoutEffect(() => {
        const loadVersion = avatarSortLoadVersionRef.current + 1;
        avatarSortLoadVersionRef.current = loadVersion;
        setAvatarReleaseStatus('all');
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarReleaseStatus: 'all'
        };

        if (profile.id !== currentUserId) {
            loadContextRef.current = {
                ...loadContextRef.current,
                avatarSort: 'name'
            };
            setAvatarSort('name');
            return;
        }

        setAvatarSort((current: any) => normalizeUserDialogAvatarSort(current));
        configRepository
            .getString(USER_DIALOG_AVATAR_SORT_CONFIG_KEY, 'name')
            .then((value: any) => {
                if (avatarSortLoadVersionRef.current !== loadVersion) {
                    return;
                }
                const nextSort = normalizeUserDialogAvatarSort(value);
                loadContextRef.current = {
                    ...loadContextRef.current,
                    avatarSort: nextSort
                };
                setAvatarSort(nextSort);
            })
            .catch(() => {
                if (avatarSortLoadVersionRef.current !== loadVersion) {
                    return;
                }
                loadContextRef.current = {
                    ...loadContextRef.current,
                    avatarSort: 'name'
                };
                setAvatarSort('name');
            });
    }, [currentUserId, profile.id]);

    function isCurrentLoadContext(context: any) {
        return (
            loadContextRef.current.endpoint === context.endpoint &&
            loadContextRef.current.userId === context.userId &&
            loadContextRef.current.reloadToken === context.reloadToken &&
            (context.tab !== 'worlds' ||
                (context.worldSort === worldSort &&
                    context.worldOrder === worldOrder)) &&
            (context.tab !== 'avatars' ||
                (context.avatarSort === avatarSort &&
                    context.currentAvatarId === currentAvatarId &&
                    context.previousAvatarSwapTime === previousAvatarSwapTime &&
                    context.avatarReleaseStatus ===
                        effectiveAvatarReleaseStatus))
        );
    }

    function isCurrentCountContext(context: any) {
        return (
            countContextRef.current.endpoint === context.endpoint &&
            countContextRef.current.userId === context.userId &&
            countContextRef.current.currentUserId === context.currentUserId &&
            countContextRef.current.currentAvatarId ===
                context.currentAvatarId &&
            countContextRef.current.previousAvatarSwapTime ===
                context.previousAvatarSwapTime &&
            countContextRef.current.avatarReleaseStatus ===
                context.avatarReleaseStatus &&
            countContextRef.current.reloadToken === context.reloadToken
        );
    }

    async function loadTabCounts({ force = false }: any = {}) {
        if (!profile.id) {
            return;
        }

        const countContext: any = {
            endpoint: currentEndpoint,
            userId: profile.id,
            currentUserId,
            currentAvatarId,
            previousAvatarSwapTime,
            avatarReleaseStatus: effectiveAvatarReleaseStatus,
            reloadToken
        };
        try {
            const counts = await loadUserDialogTabCounts({
                userId: profile.id,
                endpoint: currentEndpoint,
                currentUserId,
                currentAvatarId,
                previousAvatarSwapTime,
                effectiveAvatarReleaseStatus,
                repositories: userDialogTabServiceRepositories,
                force
            });
            if (!isCurrentCountContext(countContext)) {
                return;
            }
            setRemoteTabCounts(counts);
        } catch {
            if (isCurrentCountContext(countContext)) {
                setRemoteTabCounts(emptyUserDialogStatus);
            }
        }
    }

    async function loadTab(tab: any, { force = false }: any = {}) {
        if (
            !profile.id ||
            (!force &&
                (remoteStatus[tab] === 'running' ||
                    remoteStatus[tab] === 'ready'))
        ) {
            return;
        }
        if (!isUserDialogDataTab(tab)) {
            return;
        }

        const loadContext: any = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            tab,
            worldSort,
            worldOrder,
            avatarSort,
            currentAvatarId,
            previousAvatarSwapTime,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteStatus((current: any) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current: any) => ({ ...current, [tab]: '' }));
        try {
            const { rows, favoriteWorldGroups } = await loadUserDialogTabData({
                tab,
                userId: profile.id,
                endpoint: currentEndpoint,
                currentUserId,
                currentAvatarId,
                previousAvatarSwapTime,
                worldSort,
                worldOrder,
                repositories: userDialogTabServiceRepositories
            });

            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            const dataKey = userDialogDataKeyForTab(tab);
            setRemoteData((current: any) => ({
                ...current,
                [dataKey]: rows,
                ...(tab === 'favorite-worlds' ? { favoriteWorldGroups } : {})
            }));
            setRemoteStatus((current: any) => ({ ...current, [tab]: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current: any) => ({ ...current, [tab]: 'error' }));
            setRemoteErrors((current: any) => ({
                ...current,
                [tab]:
                    error instanceof Error
                        ? error.message
                        : 'Failed to load tab data.'
            }));
        }
    }

    function changeTab(tab: any, { allowHidden = false }: any = {}) {
        const nextTab = allowHidden
            ? tab
            : resolveTabValue(visibleTabs(viewData.tabs), tab);
        lastUserDialogTab = allowHidden
            ? 'info'
            : resolveTabValue(visibleTabs(viewData.tabs), tab);
        setActiveTab(nextTab);
    }

    function changeWorldSort(value: any) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldSort: value
        };
        setWorldSort(value);
        setRemoteStatus((current: any) => ({ ...current, worlds: '' }));
    }

    function changeWorldOrder(value: any) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldOrder: value
        };
        setWorldOrder(value);
        setRemoteStatus((current: any) => ({ ...current, worlds: '' }));
    }

    function changeAvatarSort(value: any) {
        const nextSort = normalizeUserDialogAvatarSort(value);
        avatarSortLoadVersionRef.current += 1;
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarSort: nextSort
        };
        setAvatarSort(nextSort);
        if (profile.id === currentUserId) {
            configRepository.setString(
                USER_DIALOG_AVATAR_SORT_CONFIG_KEY,
                nextSort
            );
            setRemoteStatus((current: any) => ({ ...current, avatars: '' }));
        }
    }

    function changeAvatarReleaseStatus(value: any) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarReleaseStatus: value
        };
        setAvatarReleaseStatus(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current: any) => ({ ...current, avatars: '' }));
        }
    }

    async function refreshTab(tab: any) {
        setRemoteStatus((current: any) => ({ ...current, [tab]: '' }));
        setRemoteData((current: any) => ({
            ...current,
            ...emptyDataPatchForTab(tab)
        }));
        await loadTab(tab, { force: true });
    }

    useEffect(() => {
        const shouldForceReload =
            reloadToken > 0 && handledReloadTokenRef.current !== reloadToken;
        if (shouldForceReload) {
            handledReloadTokenRef.current = reloadToken;
        }
        loadTab(activeTab, { force: shouldForceReload });
    }, [
        activeTab,
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        previousAvatarSwapTime,
        profile.id,
        reloadToken
    ]);

    useEffect(() => {
        const shouldForceReload =
            reloadToken > 0 &&
            handledCountReloadTokenRef.current !== reloadToken;
        if (shouldForceReload) {
            handledCountReloadTokenRef.current = reloadToken;
        }
        loadTabCounts({ force: shouldForceReload });
    }, [
        currentEndpoint,
        currentAvatarId,
        currentUserId,
        effectiveAvatarReleaseStatus,
        previousAvatarSwapTime,
        profile.id,
        reloadToken
    ]);

    useEffect(() => {
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response: any) => {
                if (active) {
                    setVrchatConfigConstants(response?.json?.constants || null);
                }
            })
            .catch(() => {
                if (active) {
                    setVrchatConfigConstants(null);
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint]);

    useEffect(() => {
        if (activeTab === 'worlds') {
            loadTab('worlds', { force: true });
        }
    }, [worldOrder, worldSort]);

    useEffect(() => {
        if (activeTab === 'avatars' && profile.id === currentUserId) {
            loadTab('avatars', { force: true });
        }
    }, [
        avatarReleaseStatus,
        avatarSort,
        currentAvatarId,
        previousAvatarSwapTime
    ]);

    useEffect(
        () =>
            onPreferenceChanged(AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS, () => {
                if (profile.id === currentUserId) {
                    return;
                }
                setRemoteData((current: any) => ({ ...current, avatars: [] }));
                setRemoteStatus((current: any) => ({
                    ...current,
                    avatars: ''
                }));
                setRemoteErrors((current: any) => ({
                    ...current,
                    avatars: ''
                }));
                setRemoteTabCounts((current: any) => ({
                    ...current,
                    avatars: undefined
                }));
                loadTabCounts({ force: true });
                if (activeTab === 'avatars') {
                    loadTab('avatars', { force: true });
                }
            }),
        [
            activeTab,
            avatarReleaseStatus,
            avatarSort,
            currentEndpoint,
            currentUserId,
            profile.id
        ]
    );

    useEffect(() => {
        setMutualSort('alphabetical');
        setGroupSort(isCurrentUser ? 'inGame' : 'alphabetical');
    }, [currentUserId, isCurrentUser, profile.id]);

    return {
        ...viewData,
        activeTab,
        avatarReleaseStatus,
        avatarSort,
        changeAvatarReleaseStatus,
        changeAvatarSort,
        changeTab,
        changeWorldOrder,
        changeWorldSort,
        effectiveAvatarReleaseStatus,
        groupSort,
        loadTab,
        mutualSort,
        refreshGroups: () => refreshTab('groups'),
        remoteData,
        remoteErrors,
        remoteStatus,
        remoteTabCounts,
        search,
        setGroupSort,
        setMutualSort,
        setSearch,
        tabs: viewData.tabs,
        vrchatConfigConstants,
        worldOrder,
        worldSort
    };
}
