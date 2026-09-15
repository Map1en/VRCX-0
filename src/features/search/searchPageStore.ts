import { useCallback } from 'react';
import { create } from 'zustand';

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import type {
    AvatarSearchRequest,
    GroupSearchRequest,
    SearchActiveTab,
    SearchAvatarResult,
    SearchGroupResult,
    SearchUserResult,
    SearchWorldResult,
    UserSearchRequest,
    WorldSearchRequest
} from './searchTypes';

interface SearchPageState {
    activeTab: SearchActiveTab;
    searchText: string;
    searchUserByBio: boolean;
    searchUserSortByLastLoggedIn: boolean;
    selectedWorldCategory: string;
    includeCommunityLabs: boolean;
    userRequest: UserSearchRequest | null;
    userResults: SearchUserResult[];
    isUserLoading: boolean;
    worldRequest: WorldSearchRequest | null;
    worldResults: SearchWorldResult[];
    isWorldLoading: boolean;
    groupRequest: GroupSearchRequest | null;
    groupResults: SearchGroupResult[];
    isGroupLoading: boolean;
    avatarRequest: AvatarSearchRequest | null;
    avatarResults: SearchAvatarResult[];
    isAvatarLoading: boolean;
    searchSequence: Record<SearchActiveTab, number>;
}

function createSearchPageState(): SearchPageState {
    return {
        activeTab: 'user',
        searchText: '',
        searchUserByBio: false,
        searchUserSortByLastLoggedIn: false,
        selectedWorldCategory: '',
        includeCommunityLabs: false,
        userRequest: null,
        userResults: [],
        isUserLoading: false,
        worldRequest: null,
        worldResults: [],
        isWorldLoading: false,
        groupRequest: null,
        groupResults: [],
        isGroupLoading: false,
        avatarRequest: null,
        avatarResults: [],
        isAvatarLoading: false,
        searchSequence: { user: 0, world: 0, group: 0, avatar: 0 }
    };
}

export const useSearchPageStore = create<SearchPageState>(() =>
    createSearchPageState()
);

export function resetSearchPageState() {
    const sequence = useSearchPageStore.getState().searchSequence;
    sequence.user += 1;
    sequence.world += 1;
    sequence.group += 1;
    sequence.avatar += 1;
    useSearchPageStore.setState(createSearchPageState(), true);
}

useRuntimeStore.subscribe((state, previous) => {
    if (
        state.auth.currentUserId !== previous.auth.currentUserId ||
        state.auth.currentUserEndpoint !== previous.auth.currentUserEndpoint
    ) {
        resetSearchPageState();
    }
});

useSessionStore.subscribe((state, previous) => {
    if (previous.isLoggedIn && !state.isLoggedIn) {
        resetSearchPageState();
    }
});

export function useSearchPageField<K extends keyof SearchPageState>(key: K) {
    const value = useSearchPageStore((state) => state[key]);
    const setValue = useCallback(
        (nextValue: SearchPageState[K]) => {
            useSearchPageStore.setState((state) => ({
                ...state,
                [key]: nextValue
            }));
        },
        [key]
    );
    return [value, setValue] as const;
}
