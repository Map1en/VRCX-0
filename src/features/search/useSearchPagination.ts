import { useMemo } from 'react';

import { SEARCH_PAGE_SIZE as PAGE_SIZE } from './searchRequests';
import type { SearchPaginationState } from './searchTypes';

type PagedSearchRequest = {
    option?: string;
    params: {
        n: number;
        offset: number;
    };
};

type AvatarPaginationRequest = {
    offset: number;
    provider: string;
    query: string;
};

function pageOf(offset: number | undefined, size: number | undefined) {
    const step = size || PAGE_SIZE;
    return Math.floor((offset ?? 0) / step) + 1;
}

export function useSearchPagination<
    TAvatarRequest extends AvatarPaginationRequest,
    TGroupRequest extends PagedSearchRequest,
    TUserRequest extends PagedSearchRequest,
    TWorldRequest extends PagedSearchRequest
>({
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
}: {
    activeTab: string;
    avatarRequest: TAvatarRequest | null;
    avatarResults: readonly unknown[];
    groupRequest: TGroupRequest | null;
    groupResults: readonly unknown[];
    isAvatarLoading: boolean;
    isGroupLoading: boolean;
    isUserLoading: boolean;
    isWorldLoading: boolean;
    runGroupSearch: (request: TGroupRequest) => void;
    runUserSearch: (request: TUserRequest) => void;
    runWorldSearch: (request: TWorldRequest) => void;
    setAvatarRequest: (request: TAvatarRequest) => void;
    userRequest: TUserRequest | null;
    userResults: readonly unknown[];
    worldRequest: TWorldRequest | null;
    worldResults: readonly unknown[];
}): SearchPaginationState {
    return useMemo(() => {
        if (activeTab === 'user') {
            return {
                show: userResults.length > 0 && !isUserLoading,
                page: pageOf(
                    userRequest?.params?.offset,
                    userRequest?.params?.n
                ),
                prevDisabled: !userRequest?.params?.offset,
                nextDisabled:
                    userResults.length < (userRequest?.params?.n ?? PAGE_SIZE),
                onPrev() {
                    if (!userRequest) {
                        return;
                    }
                    const offset = Math.max(
                        0,
                        (userRequest.params.offset ?? 0) -
                            (userRequest.params.n ?? PAGE_SIZE)
                    );
                    runUserSearch({
                        ...userRequest,
                        params: {
                            ...userRequest.params,
                            offset
                        }
                    });
                },
                onNext() {
                    if (!userRequest) {
                        return;
                    }
                    const step = userRequest.params.n ?? PAGE_SIZE;
                    runUserSearch({
                        ...userRequest,
                        params: {
                            ...userRequest.params,
                            offset: (userRequest.params.offset ?? 0) + step
                        }
                    });
                }
            };
        }

        if (activeTab === 'world') {
            return {
                show: worldResults.length > 0 && !isWorldLoading,
                page: pageOf(
                    worldRequest?.params?.offset,
                    worldRequest?.params?.n
                ),
                prevDisabled: !worldRequest?.params?.offset,
                nextDisabled:
                    worldResults.length <
                    (worldRequest?.params?.n ?? PAGE_SIZE),
                onPrev() {
                    if (!worldRequest) {
                        return;
                    }
                    const offset = Math.max(
                        0,
                        (worldRequest.params.offset ?? 0) -
                            (worldRequest.params.n ?? PAGE_SIZE)
                    );
                    runWorldSearch({
                        ...worldRequest,
                        params: {
                            ...worldRequest.params,
                            offset
                        }
                    });
                },
                onNext() {
                    if (!worldRequest) {
                        return;
                    }
                    const step = worldRequest.params.n ?? PAGE_SIZE;
                    runWorldSearch({
                        ...worldRequest,
                        params: {
                            ...worldRequest.params,
                            offset: (worldRequest.params.offset ?? 0) + step
                        }
                    });
                }
            };
        }

        if (activeTab === 'group') {
            return {
                show: groupResults.length > 0 && !isGroupLoading,
                page: pageOf(
                    groupRequest?.params?.offset,
                    groupRequest?.params?.n
                ),
                prevDisabled: !groupRequest?.params?.offset,
                nextDisabled:
                    groupResults.length <
                    (groupRequest?.params?.n ?? PAGE_SIZE),
                onPrev() {
                    if (!groupRequest) {
                        return;
                    }
                    const offset = Math.max(
                        0,
                        (groupRequest.params.offset ?? 0) -
                            (groupRequest.params.n ?? PAGE_SIZE)
                    );
                    runGroupSearch({
                        ...groupRequest,
                        params: {
                            ...groupRequest.params,
                            offset
                        }
                    });
                },
                onNext() {
                    if (!groupRequest) {
                        return;
                    }
                    const step = groupRequest.params.n ?? PAGE_SIZE;
                    runGroupSearch({
                        ...groupRequest,
                        params: {
                            ...groupRequest.params,
                            offset: (groupRequest.params.offset ?? 0) + step
                        }
                    });
                }
            };
        }

        if (activeTab === 'avatar') {
            const offset = avatarRequest?.offset ?? 0;
            return {
                show: avatarResults.length > 0 && !isAvatarLoading,
                page: pageOf(offset, PAGE_SIZE),
                prevDisabled: offset <= 0,
                nextDisabled: offset + PAGE_SIZE >= avatarResults.length,
                onPrev() {
                    if (!avatarRequest) {
                        return;
                    }
                    setAvatarRequest({
                        ...avatarRequest,
                        offset: Math.max(0, offset - PAGE_SIZE)
                    });
                },
                onNext() {
                    if (!avatarRequest) {
                        return;
                    }
                    setAvatarRequest({
                        ...avatarRequest,
                        offset: offset + PAGE_SIZE
                    });
                }
            };
        }

        return {
            show: false,
            page: 1,
            prevDisabled: true,
            nextDisabled: true,
            onPrev() {},
            onNext() {}
        };
    }, [
        activeTab,
        avatarRequest,
        avatarResults.length,
        groupRequest,
        groupResults.length,
        isAvatarLoading,
        isGroupLoading,
        isUserLoading,
        isWorldLoading,
        runGroupSearch,
        runUserSearch,
        runWorldSearch,
        setAvatarRequest,
        userRequest,
        userResults.length,
        worldRequest,
        worldResults.length
    ]);
}
