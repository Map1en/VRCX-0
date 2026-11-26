import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FavoriteGroupMap, FavoriteKind } from '@/domain/favorites/types';
import { commands, type FavoriteRow } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

type CustomOrderState = {
    kind: FavoriteKind;
    orderByGroup: FavoriteGroupMap;
};

function rowEntityId(row: FavoriteRow, kind: FavoriteKind): string {
    const entityId =
        kind === 'friend'
            ? row.userId
            : kind === 'avatar'
              ? row.avatarId
              : row.worldId;
    return (entityId ?? '').trim();
}

export function buildCustomOrderByGroup(
    rows: readonly FavoriteRow[],
    kind: FavoriteKind
): FavoriteGroupMap {
    const orderByGroup: FavoriteGroupMap = {};
    for (const row of rows) {
        const entityId = rowEntityId(row, kind);
        if (!entityId) {
            continue;
        }
        const ids = (orderByGroup[String(row.groupId)] ??= []);
        if (!ids.includes(entityId)) {
            ids.push(entityId);
        }
    }
    return orderByGroup;
}

export function moveFavoritesToEdge(
    entityIds: readonly string[],
    selectedIds: ReadonlySet<string>,
    edge: 'top' | 'bottom'
): string[] {
    const selected = entityIds.filter((entityId) => selectedIds.has(entityId));
    const rest = entityIds.filter((entityId) => !selectedIds.has(entityId));
    return edge === 'top' ? [...selected, ...rest] : [...rest, ...selected];
}

export function useLocalFavoriteCustomOrder({
    currentUserId,
    enabled,
    kind
}: {
    currentUserId: string;
    enabled: boolean;
    kind: FavoriteKind;
}) {
    const { t } = useTranslation();
    const revision = useFavoriteRevisionStore((state) => state.revision);
    const [state, setState] = useState<CustomOrderState | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const sequenceRef = useRef(0);

    useEffect(() => {
        if (!enabled) {
            sequenceRef.current += 1;
            setState(null);
            return;
        }
        const sequence = ++sequenceRef.current;
        commands
            .appFavoriteLocalCustomOrder(kind)
            .then((rows) => {
                if (sequence === sequenceRef.current) {
                    setState({
                        kind,
                        orderByGroup: buildCustomOrderByGroup(rows, kind)
                    });
                }
            })
            .catch((error: unknown) => {
                console.warn('Failed to load local favorite order:', error);
            });
    }, [currentUserId, enabled, kind, reloadToken, revision]);

    const reorderGroup = useCallback(
        async (groupKey: string, entityIds: string[]) => {
            sequenceRef.current += 1;
            setState((current) => ({
                kind,
                orderByGroup: {
                    ...(current?.kind === kind ? current.orderByGroup : {}),
                    [groupKey]: entityIds
                }
            }));
            try {
                await commands.appLocalFavoriteReorder({
                    kind,
                    groupId: Number(groupKey),
                    entityIds
                });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.favorites.toast.failed_to_save_order')
                });
                setReloadToken((token) => token + 1);
            }
        },
        [kind, t]
    );

    return {
        customOrderByGroup:
            enabled && state?.kind === kind ? state.orderByGroup : undefined,
        reorderGroup
    };
}
