import { toast } from 'sonner';

import { invalidateEntityQueries } from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import type { PrintAutoCleanupEvent } from '@/platform/tauri/bindings';
import mediaRepository from '@/repositories/vrchatMediaRepository';
import { printCleanupWarningMessageKey } from '@/shared/utils/printFavoriteMessages';
import { normalizeString } from '@/shared/utils/string';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';
import {
    type FavoriteRevisionKind,
    useFavoriteRevisionStore
} from '@/state/favoriteRevisionStore';
import type { FavoriteKind } from '@/state/favoriteStoreTypes';
import { usePrintFavoriteStore } from '@/state/printFavoriteStore';
import {
    createGroupInstancesState,
    useRuntimeStore
} from '@/state/runtimeStore';

import { refreshLocalFavoritesForKinds } from '../favoriteLocalRefreshService';
import i18n from '../i18nService';
import type {
    FavoritesChangedEventPayload,
    RuntimeGroupInstancesProjection
} from './types';

let lastPrintCleanupWarning: string | null = null;

function showPrintCleanupToast(event: PrintAutoCleanupEvent): void {
    const warningKey = printCleanupWarningMessageKey(event.warning);
    if (warningKey) {
        if (event.warning !== lastPrintCleanupWarning) {
            lastPrintCleanupWarning = event.warning ?? null;
            toast.warning(
                i18n.t(warningKey, {
                    remaining: event.remaining
                })
            );
        }
        return;
    }

    lastPrintCleanupWarning = null;
    if (event.deleted > 0) {
        toast.success(
            i18n.t('view.tools.prints_favorites.cleanup_deleted', {
                count: event.deleted,
                remaining: event.remaining
            })
        );
    }
}

function refreshPrintFavoritesAfterCleanup(): void {
    mediaRepository
        .getPrintFavorites()
        .then((state) => {
            usePrintFavoriteStore.getState().hydratePrintFavorites(state);
        })
        .catch((error: unknown) => {
            console.warn(
                'Failed to refresh print favorites after cleanup:',
                error
            );
        });
}

function normalizeFavoritesChangedKind(kind: string): FavoriteRevisionKind {
    return kind === 'friend' || kind === 'world' || kind === 'avatar'
        ? kind
        : 'unknown';
}

export function handlePrintCleanupEvent(event: PrintAutoCleanupEvent): void {
    usePrintFavoriteStore.getState().applyPrintCleanup(event);
    refreshPrintFavoritesAfterCleanup();
    showPrintCleanupToast(event);
}

export function handleFavoritesChangedEvent(
    payload: FavoritesChangedEventPayload
): void {
    void invalidateEntityQueries(['quickSearch']);
    const kind = normalizeFavoritesChangedKind(payload.kind);
    useFavoriteRevisionStore.getState().bumpRevision({
        kind,
        remote: Boolean(payload.remote)
    });
    if (!payload.local) {
        return;
    }
    const kinds: FavoriteKind[] =
        kind === 'unknown' ? ['friend', 'world', 'avatar'] : [kind];
    refreshLocalFavoritesForKinds(kinds).catch((error: unknown) => {
        console.warn('Failed to refresh local favorites after change:', error);
    });
}

export function handleRuntimeGroupInstancesProjection(
    record: RuntimeGroupInstancesProjection
): void {
    const runtimeStore = useRuntimeStore.getState();
    const status = normalizeString(record.status) || 'ready';
    const userId = normalizeString(record.userId);
    const endpoint = normalizeString(record.endpoint);
    const auth = runtimeStore.auth;
    const currentUserId = normalizeString(auth.currentUserId);
    const currentEndpoint = normalizeString(auth.currentUserEndpoint);
    if (!currentUserId || !userId) {
        if (status === 'idle') {
            runtimeStore.setGroupInstancesState(createGroupInstancesState());
        }
        return;
    }
    if (
        userId !== currentUserId ||
        normalizeVrchatEndpointDomain(endpoint) !==
            normalizeVrchatEndpointDomain(currentEndpoint)
    ) {
        return;
    }
    const instances = Array.isArray(record.instances)
        ? record.instances
        : undefined;
    const groupOrder = Array.isArray(record.groupOrder)
        ? record.groupOrder
        : undefined;
    const patch: Record<string, unknown> = {
        status,
        userId: currentUserId,
        endpoint: currentEndpoint,
        lastLoadedAt: new Date().toISOString(),
        error: normalizeString(record.error)
    };
    if (instances) {
        patch.instances = instances;
    }
    if (groupOrder) {
        patch.groupOrder = groupOrder;
    }
    if (record.fetchedAt) {
        patch.fetchedAt = record.fetchedAt;
    }
    runtimeStore.setGroupInstancesState(patch);
}

export function requestGroupInstancesRefresh(source: string): void {
    commands.appRuntimeGroupInstancesRefresh().catch((error: unknown) => {
        console.warn(
            `Runtime group instances refresh failed during ${source}:`,
            error
        );
    });
}
