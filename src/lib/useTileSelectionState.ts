import { useEffect, useMemo, useRef, useState } from 'react';

export function computeSelectionRangeKeys({
    fromIndex,
    keys,
    toIndex
}: {
    fromIndex: number;
    keys: readonly string[];
    toIndex: number;
}): string[] {
    const start = Math.max(0, Math.min(fromIndex, toIndex));
    const end = Math.min(keys.length - 1, Math.max(fromIndex, toIndex));
    if (start > end) {
        return [];
    }
    return keys.slice(start, end + 1);
}

export function useTileSelectionState({
    keys,
    resetToken
}: {
    keys: readonly string[];
    resetToken?: string;
}) {
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const lastSelectedKeyRef = useRef<string | null>(null);
    const selectedKeysSet = useMemo(
        () => new Set(selectedKeys),
        [selectedKeys]
    );
    const hasSelection = selectedKeysSet.size > 0;
    const isAllSelected =
        keys.length > 0 && keys.every((key) => selectedKeysSet.has(key));

    useEffect(() => {
        setSelectedKeys([]);
        lastSelectedKeyRef.current = null;
    }, [resetToken]);

    useEffect(() => {
        setSelectedKeys((current) => {
            if (current.length === 0) {
                return current;
            }
            const availableKeys = new Set(keys);
            const nextKeys = current.filter((key) => availableKeys.has(key));
            return nextKeys.length === current.length ? current : nextKeys;
        });
    }, [keys]);

    function clearSelection() {
        setSelectedKeys([]);
        lastSelectedKeyRef.current = null;
    }

    function toggleSelectAll() {
        if (isAllSelected) {
            clearSelection();
            return;
        }
        setSelectedKeys([...keys]);
        lastSelectedKeyRef.current = keys[keys.length - 1] ?? null;
    }

    function selectItem(
        key: string,
        checked: boolean,
        options?: { shift?: boolean }
    ) {
        const index = keys.indexOf(key);
        if (index < 0) {
            return;
        }
        const lastKey = lastSelectedKeyRef.current;
        const lastIndex =
            options?.shift && lastKey !== null ? keys.indexOf(lastKey) : -1;
        const rangeKeys =
            lastIndex >= 0
                ? computeSelectionRangeKeys({
                      keys,
                      fromIndex: lastIndex,
                      toIndex: index
                  })
                : [key];
        setSelectedKeys((current) => {
            const nextKeys = new Set(current);
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
        clearSelection,
        hasSelection,
        isAllSelected,
        selectedKeys,
        selectedKeysSet,
        selectItem,
        setSelectedKeys,
        toggleSelectAll
    };
}
