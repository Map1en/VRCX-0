import { useEffect, useState } from 'react';

import type {
    FavoriteGroup,
    FavoriteKind,
    FavoriteSource
} from './favoritesTypes';

export function useFavoritesFilters({ kind }: { kind: FavoriteKind }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState('name');
    const [selectedSource, setSelectedSource] =
        useState<FavoriteSource>('remote');
    const [selectedGroupKey, setSelectedGroupKey] = useState('');

    useEffect(() => {
        setSearchQuery('');
        setSearchMode('name');
        setSelectedSource('remote');
        setSelectedGroupKey('');
    }, [kind]);

    return {
        searchMode,
        searchQuery,
        selectedGroupKey,
        selectedSource,
        setSearchMode,
        setSearchQuery,
        setSelectedGroupKey,
        setSelectedSource
    };
}

export function useFavoritesSelectedGroupSync({
    avatarHistoryGroups,
    localGroups,
    remoteGroups,
    selectedGroupKey,
    selectedSource,
    setSelectedGroupKey,
    setSelectedSource
}: {
    avatarHistoryGroups: FavoriteGroup[];
    localGroups: FavoriteGroup[];
    remoteGroups: FavoriteGroup[];
    selectedGroupKey: string;
    selectedSource: FavoriteSource;
    setSelectedGroupKey(value: string): void;
    setSelectedSource(value: FavoriteSource): void;
}) {
    useEffect(() => {
        const activeGroups =
            selectedSource === 'remote'
                ? remoteGroups
                : selectedSource === 'history'
                  ? avatarHistoryGroups
                  : localGroups;
        if (activeGroups.some((group) => group.key === selectedGroupKey)) {
            return;
        }

        const nextGroup =
            remoteGroups.find((group) => Number(group.count) > 0) ||
            localGroups.find((group) => Number(group.count) > 0) ||
            avatarHistoryGroups.find((group) => Number(group.count) > 0) ||
            remoteGroups[0] ||
            localGroups[0] ||
            avatarHistoryGroups[0] ||
            null;
        if (!nextGroup) {
            setSelectedGroupKey('');
            return;
        }
        setSelectedSource(nextGroup.source);
        setSelectedGroupKey(nextGroup.key);
    }, [
        avatarHistoryGroups,
        localGroups,
        remoteGroups,
        selectedGroupKey,
        selectedSource,
        setSelectedGroupKey,
        setSelectedSource
    ]);
}
