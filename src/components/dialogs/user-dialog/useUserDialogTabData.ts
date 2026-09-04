import {
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityRecord } from '@/domain/entities/shared';
import type { FriendRosterById } from '@/domain/friends/types';
import { AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS } from '@/repositories/avatarSearchProviderRepository';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import configRepository from '@/repositories/configRepository';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';
import { useMutualGraphRevisionStore } from '@/state/mutualGraphRevisionStore';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import {
    isUserDialogAvatarSort,
    type UserDialogAvatarReleaseStatus,
    type UserDialogAvatarSort,
    type UserDialogGroupSort,
    type UserDialogMutualFriendSort,
    type UserDialogWorldOrder,
    type UserDialogWorldSort
} from './userDialogListOptions';
import { resolveTabValue } from './userDialogRows';
import {
    isUserDialogDataTab,
    loadUserDialogTabData,
    loadUserDialogTabCounts,
    userDialogDataKeyForTab,
    type UserDialogDataTab,
    type UserDialogRemoteStatus,
    type UserDialogTabCounts
} from './userDialogTabService';
import { buildUserDialogListViewData } from './userDialogViewData';
import type { UserDialogProfileRecord } from './useUserDialogProfileResource';

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

type UserDialogRemoteData = {
    groups: readonly EntityRecord[];
    mutual: readonly EntityRecord[];
    worlds: readonly EntityRecord[];
    favoriteWorldGroups: readonly EntityRecord[];
    favoriteWorlds: readonly EntityRecord[];
    avatars: readonly EntityRecord[];
};

type UserDialogLoadContext = {
    endpoint: string;
    userId: string;
    reloadToken: number;
    tab?: UserDialogDataTab;
    worldSort?: UserDialogWorldSort;
    worldOrder?: UserDialogWorldOrder;
    avatarSort?: UserDialogAvatarSort;
    avatarReleaseStatus?: UserDialogAvatarReleaseStatus;
    currentAvatarId?: string;
    previousAvatarSwapTime?: number;
};

type UserDialogCountContext = UserDialogLoadContext & {
    currentUserId: string;
    avatarReleaseStatus: UserDialogAvatarReleaseStatus;
    includeMutualFriends: boolean;
};

interface UseUserDialogTabDataInput {
    profile: UserDialogProfileRecord;
    reloadToken: number;
    isCurrentUser: boolean;
    currentEndpoint: string;
    currentUserId: string | null;
    currentAvatarId?: string;
    previousAvatarSwapTime?: number;
    currentUserHasSharedConnectionsOptOut: boolean;
    friendsById: FriendRosterById;
    inGameGroupOrder: readonly string[];
}

function normalizeUserDialogAvatarSort(value: string): UserDialogAvatarSort {
    const normalizedValue = value.trim();
    return isUserDialogAvatarSort(normalizedValue) ? normalizedValue : 'name';
}

function emptyDataPatchForTab(
    tab: UserDialogDataTab
): Partial<UserDialogRemoteData> {
    const dataKey = userDialogDataKeyForTab(tab);
    if (!dataKey) {
        return {};
    }
    return {
        [dataKey]: [],
        ...(tab === 'favorite-worlds' ? { favoriteWorldGroups: [] } : {})
    };
}

function visibleTabs<T extends { hidden?: boolean }>(tabs: T[]) {
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
    inGameGroupOrder
}: UseUserDialogTabDataInput) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('info');
    const [remoteData, setRemoteData] = useState<UserDialogRemoteData>(
        emptyUserDialogRemoteData
    );
    const [remoteStatus, setRemoteStatus] = useState<UserDialogRemoteStatus>(
        emptyUserDialogStatus
    );
    const [remoteErrors, setRemoteErrors] = useState<
        Partial<Record<UserDialogDataTab, string>>
    >(emptyUserDialogStatus);
    const [remoteTabCounts, setRemoteTabCounts] = useState<UserDialogTabCounts>(
        emptyUserDialogStatus
    );
    const [search, setSearch] = useState(emptyUserDialogSearch);
    const [worldSort, setWorldSort] = useState<UserDialogWorldSort>('updated');
    const [worldOrder, setWorldOrder] =
        useState<UserDialogWorldOrder>('descending');
    const [avatarSort, setAvatarSort] = useState<UserDialogAvatarSort>('name');
    const [avatarReleaseStatus, setAvatarReleaseStatus] =
        useState<UserDialogAvatarReleaseStatus>('all');
    const [mutualSort, setMutualSort] =
        useState<UserDialogMutualFriendSort>('alphabetical');
    const [groupSort, setGroupSort] = useState<UserDialogGroupSort>(
        isCurrentUser ? 'inGame' : 'alphabetical'
    );
    const vrchatConfigConstants = useVrchatConfigStore(
        (state) => state.snapshot?.constants ?? null
    );
    const profileUserId = typeof profile.id === 'string' ? profile.id : '';
    const effectiveAvatarReleaseStatus =
        profileUserId === currentUserId ? avatarReleaseStatus : 'all';
    const loadContextRef = useRef<UserDialogLoadContext>({
        endpoint: currentEndpoint,
        userId: profileUserId,
        reloadToken
    });
    const countContextRef = useRef<UserDialogCountContext>({
        endpoint: currentEndpoint,
        userId: profileUserId,
        currentUserId: currentUserId || '',
        avatarReleaseStatus: effectiveAvatarReleaseStatus,
        includeMutualFriends:
            !isCurrentUser && !currentUserHasSharedConnectionsOptOut,
        reloadToken
    });
    const avatarSortLoadVersionRef = useRef(0);
    const loadRequestIdRef = useRef(0);
    const tabRequestIdsRef = useRef<Partial<Record<UserDialogDataTab, number>>>(
        {}
    );
    const handledReloadTokenRef = useRef(reloadToken);
    const handledCountReloadTokenRef = useRef(reloadToken);
    countContextRef.current = {
        endpoint: currentEndpoint,
        userId: profileUserId,
        currentUserId: currentUserId || '',
        avatarReleaseStatus: effectiveAvatarReleaseStatus,
        includeMutualFriends:
            !isCurrentUser && !currentUserHasSharedConnectionsOptOut,
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
            t
        ]
    );

    const resetForTarget = useEffectEvent(() => {
        tabRequestIdsRef.current = {};
        loadContextRef.current = {
            endpoint: currentEndpoint,
            userId: profileUserId,
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
    });

    useEffect(() => {
        resetForTarget();
    }, [
        currentEndpoint,
        currentUserHasSharedConnectionsOptOut,
        isCurrentUser,
        profileUserId,
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

        if (profileUserId !== currentUserId) {
            loadContextRef.current = {
                ...loadContextRef.current,
                avatarSort: 'name'
            };
            setAvatarSort('name');
            return;
        }

        setAvatarSort((current) => normalizeUserDialogAvatarSort(current));
        configRepository
            .getString(USER_DIALOG_AVATAR_SORT_CONFIG_KEY, 'name')
            .then((value) => {
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
    }, [currentUserId, profileUserId]);

    function isCurrentLoadContext(context: UserDialogLoadContext) {
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

    function isCurrentCountContext(context: UserDialogCountContext) {
        return (
            countContextRef.current.endpoint === context.endpoint &&
            countContextRef.current.userId === context.userId &&
            countContextRef.current.currentUserId === context.currentUserId &&
            countContextRef.current.avatarReleaseStatus ===
                context.avatarReleaseStatus &&
            countContextRef.current.includeMutualFriends ===
                context.includeMutualFriends &&
            countContextRef.current.reloadToken === context.reloadToken
        );
    }

    async function loadTabCounts({ force = false }: { force?: boolean } = {}) {
        if (!profileUserId) {
            return;
        }

        const countContext: UserDialogCountContext = {
            endpoint: currentEndpoint,
            userId: profileUserId,
            currentUserId: currentUserId || '',
            avatarReleaseStatus: effectiveAvatarReleaseStatus,
            includeMutualFriends:
                !isCurrentUser && !currentUserHasSharedConnectionsOptOut,
            reloadToken
        };
        try {
            const counts = await loadUserDialogTabCounts({
                userId: profileUserId,
                endpoint: currentEndpoint,
                currentUserId: currentUserId || '',
                effectiveAvatarReleaseStatus,
                includeMutualFriends: countContext.includeMutualFriends,
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

    async function loadTab(
        tab: string,
        { force = false }: { force?: boolean } = {}
    ) {
        if (!isUserDialogDataTab(tab)) {
            return;
        }
        if (
            !profileUserId ||
            (!force &&
                (remoteStatus[tab] === 'running' ||
                    remoteStatus[tab] === 'ready'))
        ) {
            return;
        }
        const loadContext: UserDialogLoadContext = {
            endpoint: currentEndpoint,
            userId: profileUserId,
            reloadToken,
            tab,
            worldSort,
            worldOrder,
            avatarSort,
            currentAvatarId,
            previousAvatarSwapTime,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        const requestId = ++loadRequestIdRef.current;
        tabRequestIdsRef.current[tab] = requestId;
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        try {
            const { rows, favoriteWorldGroups, mutualGraphUpdated } =
                await loadUserDialogTabData({
                    tab,
                    userId: profileUserId,
                    endpoint: currentEndpoint,
                    currentUserId: currentUserId || '',
                    currentAvatarId,
                    previousAvatarSwapTime,
                    worldSort,
                    worldOrder,
                    repositories: userDialogTabServiceRepositories
                });

            if (mutualGraphUpdated) {
                useMutualGraphRevisionStore
                    .getState()
                    .bumpRevision(currentUserId || '');
            }

            if (
                tabRequestIdsRef.current[tab] !== requestId ||
                !isCurrentLoadContext(loadContext)
            ) {
                return;
            }
            const dataKey = userDialogDataKeyForTab(tab);
            setRemoteData((current) => ({
                ...current,
                [dataKey]: rows,
                ...(tab === 'favorite-worlds'
                    ? {
                          favoriteWorldGroups: favoriteWorldGroups
                      }
                    : {})
            }));
            setRemoteStatus((current) => ({ ...current, [tab]: 'ready' }));
            setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        } catch (error) {
            if (
                tabRequestIdsRef.current[tab] !== requestId ||
                !isCurrentLoadContext(loadContext)
            ) {
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

    function changeTab(tab: string, { allowHidden = false } = {}) {
        const nextTab = allowHidden
            ? tab
            : resolveTabValue(visibleTabs(viewData.tabs), tab);
        lastUserDialogTab = allowHidden
            ? 'info'
            : resolveTabValue(visibleTabs(viewData.tabs), tab);
        setActiveTab(nextTab);
    }

    function changeWorldSort(value: UserDialogWorldSort) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldSort: value
        };
        setWorldSort(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeWorldOrder(value: UserDialogWorldOrder) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldOrder: value
        };
        setWorldOrder(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeAvatarSort(value: UserDialogAvatarSort) {
        avatarSortLoadVersionRef.current += 1;
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarSort: value
        };
        setAvatarSort(value);
        if (profileUserId === currentUserId) {
            configRepository.setString(
                USER_DIALOG_AVATAR_SORT_CONFIG_KEY,
                value
            );
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    function changeAvatarReleaseStatus(value: UserDialogAvatarReleaseStatus) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarReleaseStatus: value
        };
        setAvatarReleaseStatus(value);
        if (profileUserId === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    async function refreshTab(tab: UserDialogDataTab) {
        setRemoteStatus((current) => ({ ...current, [tab]: '' }));
        setRemoteData((current) => ({
            ...current,
            ...emptyDataPatchForTab(tab)
        }));
        await loadTab(tab, { force: true });
    }

    const loadActiveTab = useEffectEvent(() => {
        const shouldForceReload =
            reloadToken > 0 && handledReloadTokenRef.current !== reloadToken;
        if (shouldForceReload) {
            handledReloadTokenRef.current = reloadToken;
        }
        loadTab(activeTab, { force: shouldForceReload });
    });

    useEffect(() => {
        loadActiveTab();
    }, [
        activeTab,
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        previousAvatarSwapTime,
        profileUserId,
        reloadToken
    ]);

    const loadCountsForTarget = useEffectEvent(() => {
        const shouldForceReload =
            reloadToken > 0 &&
            handledCountReloadTokenRef.current !== reloadToken;
        if (shouldForceReload) {
            handledCountReloadTokenRef.current = reloadToken;
        }
        loadTabCounts({ force: shouldForceReload });
    });

    useEffect(() => {
        loadCountsForTarget();
    }, [
        currentEndpoint,
        currentUserId,
        currentUserHasSharedConnectionsOptOut,
        effectiveAvatarReleaseStatus,
        isCurrentUser,
        profileUserId,
        reloadToken
    ]);

    const reloadWorldsForSort = useEffectEvent(() => {
        if (activeTab === 'worlds') {
            loadTab('worlds', { force: true });
        }
    });

    useEffect(() => {
        reloadWorldsForSort();
    }, [worldOrder, worldSort]);

    const reloadAvatarsForFilter = useEffectEvent(() => {
        if (activeTab === 'avatars' && profileUserId === currentUserId) {
            loadTab('avatars', { force: true });
        }
    });

    useEffect(() => {
        reloadAvatarsForFilter();
    }, [
        avatarReleaseStatus,
        avatarSort,
        currentAvatarId,
        previousAvatarSwapTime
    ]);

    const handleAvatarProviderPreferenceChanged = useEffectEvent(() => {
        if (profileUserId === currentUserId) {
            return;
        }
        setRemoteData((current) => ({ ...current, avatars: [] }));
        setRemoteStatus((current) => ({
            ...current,
            avatars: ''
        }));
        setRemoteErrors((current) => ({
            ...current,
            avatars: ''
        }));
        setRemoteTabCounts((current) => ({
            ...current,
            avatars: undefined
        }));
        loadTabCounts({ force: true });
        if (activeTab === 'avatars') {
            loadTab('avatars', { force: true });
        }
    });

    useEffect(
        () =>
            onPreferenceChanged(AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS, () =>
                handleAvatarProviderPreferenceChanged()
            ),
        []
    );

    useEffect(() => {
        setMutualSort('alphabetical');
        setGroupSort(isCurrentUser ? 'inGame' : 'alphabetical');
    }, [currentUserId, isCurrentUser, profileUserId]);

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
