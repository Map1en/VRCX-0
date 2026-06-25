import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatSearchRepository from '@/repositories/vrchatSearchRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { isAvatarSearchQueryLongEnough } from '@/shared/utils/avatarSearchQuery';

import {
    buildAvatarSearchRequest,
    buildGroupSearchRequest,
    buildUserSearchRequest,
    buildWorldSearchRequest,
    SEARCH_PAGE_SIZE as PAGE_SIZE
} from './searchRequests';
import { dedupeById } from './searchResults';
import { useSearchPagination } from './useSearchPagination';

export function useSearchResults({
    activeTab,
    avatarProviderEnabled,
    includeCommunityLabs,
    searchText,
    searchUserByBio,
    searchUserSortByLastLoggedIn,
    selectedAvatarProvider,
    selectedWorldCategory,
    setSearchText,
    setSelectedWorldCategory,
    worldCategories
}: any) {
    const { t } = useTranslation();
    const searchSequenceRef = useRef<any>({
        avatar: 0,
        group: 0,
        user: 0,
        world: 0
    });
    const [userRequest, setUserRequest] = useState(null);
    const [worldRequest, setWorldRequest] = useState(null);
    const [groupRequest, setGroupRequest] = useState(null);
    const [avatarRequest, setAvatarRequest] = useState<any>(null);
    const [userResults, setUserResults] = useState<any[]>([]);
    const [worldResults, setWorldResults] = useState<any[]>([]);
    const [groupResults, setGroupResults] = useState<any[]>([]);
    const [avatarResults, setAvatarResults] = useState<any[]>([]);
    const [isUserLoading, setIsUserLoading] = useState(false);
    const [isWorldLoading, setIsWorldLoading] = useState(false);
    const [isGroupLoading, setIsGroupLoading] = useState(false);
    const [isAvatarLoading, setIsAvatarLoading] = useState(false);

    const runUserSearch = useCallback(
        async (nextRequest: any) => {
            const sequence = searchSequenceRef.current.user + 1;
            searchSequenceRef.current.user = sequence;
            setIsUserLoading(true);
            setUserRequest(nextRequest);

            try {
                const response = await vrchatSearchRepository.getUsers(
                    nextRequest.params
                );
                if (searchSequenceRef.current.user !== sequence) {
                    return;
                }
                setUserResults(
                    dedupeById(response.json).map((user: any) =>
                        userProfileRepository.normalize(user)
                    )
                );
            } catch (error) {
                if (searchSequenceRef.current.user === sequence) {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t('view.search.toast.failed_to_search_users')
                    );
                }
            } finally {
                if (searchSequenceRef.current.user === sequence) {
                    setIsUserLoading(false);
                }
            }
        },
        [t]
    );

    const runWorldSearch = useCallback(
        async (nextRequest: any) => {
            const sequence = searchSequenceRef.current.world + 1;
            searchSequenceRef.current.world = sequence;
            setIsWorldLoading(true);
            setWorldRequest(nextRequest);

            try {
                const response = await vrchatSearchRepository.getWorlds(
                    nextRequest.params,
                    nextRequest.option
                );
                if (searchSequenceRef.current.world !== sequence) {
                    return;
                }
                setWorldResults(
                    dedupeById(response.json).map((world: any) =>
                        worldProfileRepository.normalize(world)
                    )
                );
            } catch (error) {
                if (searchSequenceRef.current.world === sequence) {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t('view.search.toast.failed_to_search_worlds')
                    );
                }
            } finally {
                if (searchSequenceRef.current.world === sequence) {
                    setIsWorldLoading(false);
                }
            }
        },
        [t]
    );

    const runGroupSearch = useCallback(
        async (nextRequest: any) => {
            const sequence = searchSequenceRef.current.group + 1;
            searchSequenceRef.current.group = sequence;
            setIsGroupLoading(true);
            setGroupRequest(nextRequest);

            try {
                const response = await vrchatSearchRepository.getGroups(
                    nextRequest.params
                );
                if (searchSequenceRef.current.group !== sequence) {
                    return;
                }
                setGroupResults(dedupeById(response.json));
            } catch (error) {
                if (searchSequenceRef.current.group === sequence) {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t('view.search.toast.failed_to_search_groups')
                    );
                }
            } finally {
                if (searchSequenceRef.current.group === sequence) {
                    setIsGroupLoading(false);
                }
            }
        },
        [t]
    );

    const runAvatarSearch = useCallback(
        async (nextRequest: any) => {
            const sequence = searchSequenceRef.current.avatar + 1;
            searchSequenceRef.current.avatar = sequence;
            setIsAvatarLoading(true);
            setAvatarRequest(nextRequest);

            try {
                const response =
                    await avatarSearchProviderRepository.search(nextRequest);
                if (searchSequenceRef.current.avatar !== sequence) {
                    return;
                }
                setAvatarResults(response.avatars);
                setAvatarRequest({
                    ...nextRequest,
                    offset: 0
                });
            } catch (error) {
                if (searchSequenceRef.current.avatar === sequence) {
                    toast.error(
                        userFacingErrorMessage(
                            error,
                            t('view.search.toast.failed_to_search_avatars')
                        )
                    );
                }
            } finally {
                if (searchSequenceRef.current.avatar === sequence) {
                    setIsAvatarLoading(false);
                }
            }
        },
        [t]
    );

    const handleSearch = useCallback(() => {
        if (activeTab === 'user') {
            runUserSearch(
                buildUserSearchRequest(
                    searchText,
                    searchUserByBio,
                    searchUserSortByLastLoggedIn
                )
            );
            return;
        }

        if (activeTab === 'world') {
            const category =
                worldCategories.find(
                    (row: any) => String(row.index) === selectedWorldCategory
                ) ?? null;
            runWorldSearch(
                buildWorldSearchRequest(
                    searchText,
                    category,
                    includeCommunityLabs
                )
            );
            return;
        }

        if (activeTab === 'group') {
            runGroupSearch(buildGroupSearchRequest(searchText));
            return;
        }

        if (activeTab === 'avatar') {
            if (!isAvatarSearchQueryLongEnough(searchText)) {
                toast.warning(t('view.search.avatar.min_chars_warning'));
                return;
            }
            if (!avatarProviderEnabled || !selectedAvatarProvider) {
                toast.warning(t('view.search.avatar.no_provider'));
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

    const handleClearSearch = useCallback(() => {
        searchSequenceRef.current.user += 1;
        searchSequenceRef.current.world += 1;
        searchSequenceRef.current.group += 1;
        searchSequenceRef.current.avatar += 1;
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
    }, [setSearchText]);

    const handleWorldCategoryChange = useCallback(
        (value: any) => {
            setSelectedWorldCategory(value);
            const category =
                worldCategories.find(
                    (row: any) => String(row.index) === value
                ) ?? null;
            runWorldSearch(
                buildWorldSearchRequest(
                    searchText,
                    category,
                    includeCommunityLabs
                )
            );
        },
        [
            includeCommunityLabs,
            runWorldSearch,
            searchText,
            setSelectedWorldCategory,
            worldCategories
        ]
    );

    const pagination = useSearchPagination({
        activeTab,
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
    const avatarOffset = avatarRequest?.offset ?? 0;
    const avatarPageResults = avatarResults.slice(
        avatarOffset,
        avatarOffset + PAGE_SIZE
    );

    return {
        avatarPageResults,
        groupResults,
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
