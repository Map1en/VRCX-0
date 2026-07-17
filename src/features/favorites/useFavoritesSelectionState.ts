import { useEffect, useMemo, useRef, useState } from 'react';

import type { FavoriteItem, FavoriteKind } from './favoritesTypes';

export function computeSelectionRangeKeys({
    fromIndex,
    items,
    toIndex
}: {
    fromIndex: number;
    items: FavoriteItem[];
    toIndex: number;
}): string[] {
    const start = Math.max(0, Math.min(fromIndex, toIndex));
    const end = Math.min(items.length - 1, Math.max(fromIndex, toIndex));
    if (start > end) {
        return [];
    }
    return items.slice(start, end + 1).map((item) => item.key);
}

export function useFavoritesSelectionState({
    contentItems,
    kind
}: {
    contentItems: FavoriteItem[];
    kind: FavoriteKind;
}) {
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const lastSelectedKeyRef = useRef<string | null>(null);
    const selectedKeysSet = useMemo(
        () => new Set(selectedKeys),
        [selectedKeys]
    );
    const hasSelection = selectedKeysSet.size > 0;
    const isAllSelected =
        contentItems.length > 0 &&
        contentItems.every((item) => selectedKeysSet.has(item.key));
    const selectedContentItems = useMemo(
        () => contentItems.filter((item) => selectedKeysSet.has(item.key)),
        [contentItems, selectedKeysSet]
    );
    const avatarSelectionActionsDisabled =
        kind === 'avatar' &&
        selectedContentItems.some((item) => item.source !== 'remote');

    useEffect(() => {
        setSelectedKeys([]);
        lastSelectedKeyRef.current = null;
    }, [kind]);

    useEffect(() => {
        setSelectedKeys((keys) => {
            const nextKeys = keys.filter((key) =>
                contentItems.some((item) => item.key === key)
            );
            return nextKeys.length === keys.length ? keys : nextKeys;
        });
    }, [contentItems]);

    function clearSelection() {
        setSelectedKeys([]);
        lastSelectedKeyRef.current = null;
    }

    function toggleSelectAll() {
        if (isAllSelected) {
            clearSelection();
            return;
        }
        setSelectedKeys(contentItems.map((item) => item.key));
        lastSelectedKeyRef.current =
            contentItems[contentItems.length - 1]?.key ?? null;
    }

    function selectItem(
        key: string,
        checked: boolean,
        options?: { shift?: boolean }
    ) {
        const index = contentItems.findIndex((item) => item.key === key);
        if (index < 0) {
            return;
        }
        const lastKey = lastSelectedKeyRef.current;
        const lastIndex =
            options?.shift && lastKey !== null
                ? contentItems.findIndex((item) => item.key === lastKey)
                : -1;
        const rangeKeys =
            lastIndex >= 0
                ? computeSelectionRangeKeys({
                      items: contentItems,
                      fromIndex: lastIndex,
                      toIndex: index
                  })
                : [key];
        setSelectedKeys((keys) => {
            const nextKeys = new Set(keys);
            for (const rangeKey of rangeKeys) {
                if (checked) {
                    nextKeys.add(rangeKey);
                } else {
                    nextKeys.delete(rangeKey);
                }
            }
            return Array.from(nextKeys);
        });
        lastSelectedKeyRef.current = key;
    }

    return {
        avatarSelectionActionsDisabled,
        clearSelection,
        hasSelection,
        isAllSelected,
        selectedContentItems,
        selectedKeys,
        selectedKeysSet,
        selectItem,
        setSelectedKeys,
        toggleSelectAll
    };
}
