import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatSearchRepository from '@/repositories/vrchatSearchRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { toast } from '@/services/toastService';
import { isAvatarSearchQueryLongEnough } from '@/shared/utils/avatarSearchQuery';

import type { SearchPageSizes } from './searchPageSizes';
import { useSearchPageField, useSearchPageStore } from './searchPageStore';
import {
    buildAvatarSearchRequest,
    buildGroupSearchRequest,
    buildUserSearchRequest,
    buildWorldSearchRequest
} from './searchRequests';
import { dedupeById } from './searchResults';
import type {
    AvatarSearchRequest,
    GroupSearchRequest,
    SearchActiveTab,
    SearchWorldCategory,
    UserSearchRequest,
    WorldSearchRequest
} from './searchTypes';
import { useSearchPagination } from './useSearchPagination';

export function useSearchResults({
    activeTab,
    avatarProviderEnabled,
    includeCommunityLabs,
    pageSizes,
    searchText,
    searchUserByBio,
    searchUserSortByLastLoggedIn,
    selectedAvatarProvider,
    selectedWorldCategory,
    setPageSize,
    setSearchText,
    setSelectedWorldCategory,
    worldCategories
}: {
    activeTab: SearchActiveTab;
    avatarProviderEnabled: boolean;
    includeCommunityLabs: boolean;
    pageSizes: SearchPageSizes;
    searchText: string;
    searchUserByBio: boolean;
    searchUserSortByLastLoggedIn: boolean;
    selectedAvatarProvider: string;
    selectedWorldCategory: string;
    setPageSize: (tab: SearchActiveTab, pageSize: number) => void;
    setSearchText: (value: string) => void;
    setSelectedWorldCategory: (value: string) => void;
    worldCategories: SearchWorldCategory[];
}) {
    const { t } = useTranslation();
    const searchSequence = useSearchPageStore((state) => state.searchSequence);
    const [userRequest, setUserRequest] = useSearchPageField('userRequest');
    const [userResults, setUserResults] = useSearchPageField('userResults');
    const [isUserLoading, setIsUserLoading] =
        useSearchPageField('isUserLoading');
    const [worldRequest, setWorldRequest] = useSearchPageField('worldRequest');
    const [worldResults, setWorldResults] = useSearchPageField('worldResults');
    const [isWorldLoading, setIsWorldLoading] =
        useSearchPageField('isWorldLoading');
    const [groupRequest, setGroupRequest] = useSearchPageField('groupRequest');
    const [groupResults, setGroupResults] = useSearchPageField('groupResults');
    const [isGroupLoading, setIsGroupLoading] =
        useSearchPageField('isGroupLoading');
    const [avatarRequest, setAvatarRequest] =
        useSearchPageField('avatarRequest');
    const [avatarResults, setAvatarResults] =
        useSearchPageField('avatarResults');
    const [isAvatarLoading, setIsAvatarLoading] =
        useSearchPageField('isAvatarLoading');

    const runUserSearch = useCallback(
        async (nextRequest: UserSearchRequest) => {
            const sequence = searchSequence.user + 1;
            searchSequence.user = sequence;
            setIsUserLoading(true);
            setUserRequest(nextRequest);

            try {
                const response = await vrchatSearchRepository.getUsers(
                    nextRequest.params
                );
                if (searchSequence.user !== sequence) {
                    return;
                }
                setUserResults(
                    dedupeById(response.json).map((user) =>
                        userProfileRepository.normalize(user)
                    )
                );
            } catch (error) {
                if (searchSequence.user === sequence) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t('view.search.toast.failed_to_search_users')
                    });
                }
            } finally {
                if (searchSequence.user === sequence) {
                    setIsUserLoading(false);
                }
            }
        },
        [searchSequence, setIsUserLoading, setUserRequest, setUserResults, t]
    );

    const runWorldSearch = useCallback(
        async (nextRequest: WorldSearchRequest) => {
            const sequence = searchSequence.world + 1;
            searchSequence.world = sequence;
            setIsWorldLoading(true);
            setWorldRequest(nextRequest);

            try {
                const response = await vrchatSearchRepository.getWorlds(
                    nextRequest.params,
                    nextRequest.option
                );
                if (searchSequence.world !== sequence) {
                    return;
                }
                setWorldResults(
                    dedupeById(response.json).map((world) =>
                        worldProfileRepository.normalize(world)
                    )
                );
            } catch (error) {
                if (searchSequence.world === sequence) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t('view.search.toast.failed_to_search_worlds')
                    });
                }
            } finally {
                if (searchSequence.world === sequence) {
                    setIsWorldLoading(false);
                }
            }
        },
        [searchSequence, setIsWorldLoading, setWorldRequest, setWorldResults, t]
    );

    const runGroupSearch = useCallback(
        async (nextRequest: GroupSearchRequest) => {
            const sequence = searchSequence.group + 1;
            searchSequence.group = sequence;
            setIsGroupLoading(true);
            setGroupRequest(nextRequest);

            try {
                const response = await vrchatSearchRepository.getGroups(
                    nextRequest.params
                );
                if (searchSequence.group !== sequence) {
                    return;
                }
                setGroupResults(dedupeById(response.json));
            } catch (error) {
                if (searchSequence.group === sequence) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t('view.search.toast.failed_to_search_groups')
                    });
                }
            } finally {
                if (searchSequence.group === sequence) {
                    setIsGroupLoading(false);
                }
            }
        },
        [searchSequence, setIsGroupLoading, setGroupRequest, setGroupResults, t]
    );

    const runAvatarSearch = useCallback(
        async (nextRequest: AvatarSearchRequest) => {
            const sequence = searchSequence.avatar + 1;
            searchSequence.avatar = sequence;
            setIsAvatarLoading(true);
            setAvatarRequest(nextRequest);

            try {
                const response =
                    await avatarSearchProviderRepository.search(nextRequest);
                if (searchSequence.avatar !== sequence) {
                    return;
                }
                setAvatarResults(response.avatars);
                setAvatarRequest({
                    ...nextRequest,
                    offset: 0
                });
            } catch (error) {
                if (searchSequence.avatar === sequence) {
                    toast.add({
                        type: 'error',
                        title: userFacingErrorMessage(
                            error,
                            t('view.search.toast.failed_to_search_avatars')
                        )
                    });
                }
            } finally {
                if (searchSequence.avatar === sequence) {
                    setIsAvatarLoading(false);
                }
            }
        },
        [
            searchSequence,
            setIsAvatarLoading,
            setAvatarRequest,
            setAvatarResults,
            t
        ]
    );

    const handleSearch = useCallback(() => {
        if (activeTab === 'user') {
            runUserSearch(
                buildUserSearchRequest(
                    searchText,
                    searchUserByBio,
                    searchUserSortByLastLoggedIn,
                    pageSizes.user
                )
            );
            return;
        }

        if (activeTab === 'world') {
            const category =
                worldCategories.find(
                    (row) => String(row.index) === selectedWorldCategory
                ) ?? null;
            runWorldSearch(
                buildWorldSearchRequest(
                    searchText,
                    category,
                    includeCommunityLabs,
                    pageSizes.world
                )
            );
            return;
        }

        if (activeTab === 'group') {
            runGroupSearch(
                buildGroupSearchRequest(searchText, pageSizes.group)
            );
            return;
        }

        if (activeTab === 'avatar') {
            if (!isAvatarSearchQueryLongEnough(searchText)) {
                toast.add({
                    type: 'warning',
                    title: t('view.search.avatar.min_chars_warning')
                });
                return;
            }
            if (!avatarProviderEnabled || !selectedAvatarProvider) {
                toast.add({
                    type: 'warning',
                    title: t('view.search.avatar.no_provider')
                });
                return;
            }
            runAvatarSearch(
                buildAvatarSearchRequest(searchText, selectedAvatarProvider)
            );
        }
    }, [
        activeTab,
        avatarProviderEnabled,
        includeCommunityLabs,
        pageSizes,
        runAvatarSearch,
        runGroupSearch,
        runUserSearch,
        runWorldSearch,
        searchText,
        searchUserByBio,
        searchUserSortByLastLoggedIn,
        selectedAvatarProvider,
        selectedWorldCategory,
        t,
        worldCategories
    ]);

    const activeTabRef = useRef(activeTab);
    useEffect(() => {
        if (activeTabRef.current === activeTab) {
            return;
        }
        activeTabRef.current = activeTab;
        if (!searchText.trim()) {
            return;
        }
        if (
            activeTab === 'avatar' &&
            !isAvatarSearchQueryLongEnough(searchText)
        ) {
            return;
        }
        handleSearch();
    }, [activeTab, handleSearch, searchText]);

    const handleClearSearch = useCallback(() => {
        searchSequence.user += 1;
        searchSequence.world += 1;
        searchSequence.group += 1;
        searchSequence.avatar += 1;
        setIsUserLoading(false);
        setIsWorldLoading(false);
        setIsGroupLoading(false);
        setIsAvatarLoading(false);
        setSearchText('');
        setUserResults([]);
        setWorldResults([]);
        setGroupResults([]);
        setAvatarResults([]);
        setUserRequest(null);
        setWorldRequest(null);
        setGroupRequest(null);
        setAvatarRequest(null);
    }, [
        searchSequence,
        setSearchText,
        setIsUserLoading,
        setIsWorldLoading,
        setIsGroupLoading,
        setIsAvatarLoading,
        setUserResults,
        setWorldResults,
        setGroupResults,
        setAvatarResults,
        setUserRequest,
        setWorldRequest,
        setGroupRequest,
        setAvatarRequest
    ]);

    const handleWorldCategoryChange = useCallback(
        (value: string | null) => {
            const nextValue = value ?? '';
            setSelectedWorldCategory(nextValue);
            const category =
                worldCategories.find(
                    (row) => String(row.index) === nextValue
                ) ?? null;
            runWorldSearch(
                buildWorldSearchRequest(
                    searchText,
                    category,
                    includeCommunityLabs,
                    pageSizes.world
                )
            );
        },
        [
            includeCommunityLabs,
            pageSizes.world,
            runWorldSearch,
            searchText,
            setSelectedWorldCategory,
            worldCategories
        ]
    );

    const handlePageSizeChange = useCallback(
        (pageSize: number) => {
            setPageSize(activeTab, pageSize);
            if (activeTab === 'user' && userRequest) {
                runUserSearch({
                    ...userRequest,
                    params: { ...userRequest.params, n: pageSize, offset: 0 }
                });
            } else if (activeTab === 'world' && worldRequest) {
                runWorldSearch({
                    ...worldRequest,
                    params: { ...worldRequest.params, n: pageSize, offset: 0 }
                });
            } else if (activeTab === 'group' && groupRequest) {
                runGroupSearch({
                    ...groupRequest,
                    params: { ...groupRequest.params, n: pageSize, offset: 0 }
                });
            } else if (activeTab === 'avatar' && avatarRequest) {
                setAvatarRequest({ ...avatarRequest, offset: 0 });
            }
        },
        [
            activeTab,
            avatarRequest,
            groupRequest,
            runGroupSearch,
            runUserSearch,
            runWorldSearch,
            setAvatarRequest,
            setPageSize,
            userRequest,
            worldRequest
        ]
    );

    const tabPagination = useSearchPagination({
        activeTab,
        avatarPageSize: pageSizes.avatar,
        avatarRequest,
        avatarResults,
        groupRequest,
        groupResults,
        isAvatarLoading,
        isGroupLoading,
        isUserLoading,
        isWorldLoading,
        runGroupSearch,
        runUserSearch,
        runWorldSearch,
        setAvatarRequest,
        userRequest,
        userResults,
        worldRequest,
        worldResults
    });
    const pagination = {
        ...tabPagination,
        pageSize: pageSizes[activeTab],
        onPageSizeChange: handlePageSizeChange
    };
    const avatarOffset = avatarRequest?.offset ?? 0;
    const avatarPageResults = avatarResults.slice(
        avatarOffset,
        avatarOffset + pageSizes.avatar
    );

    return {
        avatarPageResults,
        groupResults,
        hasAvatarSearched: avatarRequest !== null,
        hasGroupSearched: groupRequest !== null,
        hasUserSearched: userRequest !== null,
        hasWorldSearched: worldRequest !== null,
        handleClearSearch,
        handleSearch,
        handleWorldCategoryChange,
        isAvatarLoading,
        isGroupLoading,
        isUserLoading,
        isWorldLoading,
        pagination,
        userResults,
        worldResults
    };
}
