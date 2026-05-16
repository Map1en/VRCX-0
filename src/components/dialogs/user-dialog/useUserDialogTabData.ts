// @ts-nocheck
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import {
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
    avatarSearchProviderRepository,
    groupProfileRepository,
    myAvatarRepository,
    userProfileRepository,
    vrchatAuthRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
} from '@/repositories/index.js';

import { resolveTabValue } from './userDialogRows.js';
import {
    isUserDialogDataTab,
    loadUserDialogTabData,
    loadUserDialogTabCounts,
    userDialogDataKeyForTab
} from './userDialogTabService.js';
import { buildUserDialogListViewData } from './userDialogViewData.js';

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

function emptyDataPatchForTab(tab) {
    const dataKey = userDialogDataKeyForTab(tab);
    if (!dataKey) {
        return {};
    }
    return {
        [dataKey]: [],
        ...(tab === 'favorite-worlds' ? { favoriteWorldGroups: [] } : {})
    };
}

function visibleTabs(tabs) {
    return tabs.filter((tab) => !tab.hidden);
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
}) {
    const [activeTab, setActiveTab] = useState('info');
    const [remoteData, setRemoteData] = useState(emptyUserDialogRemoteData);
    const [remoteStatus, setRemoteStatus] = useState(emptyUserDialogStatus);
    const [remoteErrors, setRemoteErrors] = useState(emptyUserDialogStatus);
    const [remoteTabCounts, setRemoteTabCounts] = useState(
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
    const loadContextRef = useRef({
        endpoint: currentEndpoint,
        userId: profile.id,
        reloadToken
    });
    const countContextRef = useRef({
        endpoint: currentEndpoint,
        userId: profile.id,
        currentUserId,
        currentAvatarId,
        previousAvatarSwapTime,
        avatarReleaseStatus: effectiveAvatarReleaseStatus,
        reloadToken
    });
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
        setAvatarSort('name');
        setAvatarReleaseStatus('all');
    }, [currentUserId, profile.id]);

    function isCurrentLoadContext(context) {
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

    function isCurrentCountContext(context) {
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

    async function loadTabCounts({ force = false } = {}) {
        if (!profile.id) {
            return;
        }

        const countContext = {
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

    async function loadTab(tab, { force = false } = {}) {
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

        const loadContext = {
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
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
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
            setRemoteData((current) => ({
                ...current,
                [dataKey]: rows,
                ...(tab === 'favorite-worlds' ? { favoriteWorldGroups } : {})
            }));
            setRemoteStatus((current) => ({ ...current, [tab]: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, [tab]: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                [tab]:
                    error instanceof Error
                        ? error.message
                        : 'Failed to load tab data.'
            }));
        }
    }

    function changeTab(tab, { allowHidden = false } = {}) {
        const nextTab = allowHidden
            ? tab
            : resolveTabValue(visibleTabs(viewData.tabs), tab);
        lastUserDialogTab = allowHidden
            ? 'info'
            : resolveTabValue(visibleTabs(viewData.tabs), tab);
        setActiveTab(nextTab);
    }

    function changeWorldSort(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldSort: value
        };
        setWorldSort(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeWorldOrder(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldOrder: value
        };
        setWorldOrder(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeAvatarSort(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarSort: value
        };
        setAvatarSort(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    function changeAvatarReleaseStatus(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarReleaseStatus: value
        };
        setAvatarReleaseStatus(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    async function refreshTab(tab) {
        setRemoteStatus((current) => ({ ...current, [tab]: '' }));
        setRemoteData((current) => ({
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
        void loadTab(activeTab, { force: shouldForceReload });
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
        void loadTabCounts({ force: shouldForceReload });
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
            .then((response) => {
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
            void loadTab('worlds', { force: true });
        }
    }, [worldOrder, worldSort]);

    useEffect(() => {
        if (activeTab === 'avatars' && profile.id === currentUserId) {
            void loadTab('avatars', { force: true });
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
                setRemoteData((current) => ({ ...current, avatars: [] }));
                setRemoteStatus((current) => ({ ...current, avatars: '' }));
                setRemoteErrors((current) => ({ ...current, avatars: '' }));
                setRemoteTabCounts((current) => ({
                    ...current,
                    avatars: undefined
                }));
                void loadTabCounts({ force: true });
                if (activeTab === 'avatars') {
                    void loadTab('avatars', { force: true });
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
