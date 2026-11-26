import type {
    FavoriteKind,
    StoredLocalFavoriteKind
} from '@/domain/favorites/types';
import { commands } from '@/platform/tauri/bindings';
import type {
    FavoriteChange,
    PrintAutoCleanupEvent
} from '@/platform/tauri/bindings';
import mediaRepository from '@/repositories/vrchatMediaRepository';
import { toast } from '@/services/toastService';
import { printCleanupWarningMessageKey } from '@/shared/utils/printFavoriteMessages';
import { isRecord } from '@/shared/utils/record';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';
import { useFavoriteStore } from '@/state/favoriteStore';
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
let pendingFavoritesChangedEvents: FavoritesChangedEventPayload[] = [];
let flushingFavoritesChangedEvents = false;
const MAX_PENDING_FAVORITES_CHANGED_EVENTS = 64;

function showPrintCleanupToast(event: PrintAutoCleanupEvent): void {
    const warningKey = printCleanupWarningMessageKey(event.warning);
    if (warningKey) {
        if (event.warning !== lastPrintCleanupWarning) {
            lastPrintCleanupWarning = event.warning ?? null;
            toast.add({
                type: 'warning',
                title: i18n.t(warningKey, {
                    remaining: event.remaining
                })
            });
        }
        return;
    }

    lastPrintCleanupWarning = null;
    if (event.deleted > 0) {
        toast.add({
            type: 'success',
            title: i18n.t('view.tools.prints_favorites.cleanup_deleted', {
                count: event.deleted,
                remaining: event.remaining
            })
        });
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

function isStoredLocalFavoriteKind(
    kind: FavoriteKind
): kind is StoredLocalFavoriteKind {
    return kind === 'friend' || kind === 'avatar';
}

function applyFavoriteChange(change: FavoriteChange): void {
    const favorites = useFavoriteStore.getState();
    switch (change.type) {
        case 'localAdded':
            if (isStoredLocalFavoriteKind(change.kind)) {
                favorites.addLocalFavorite({
                    kind: change.kind,
                    entityId: change.entityId,
                    groupId: change.groupId
                });
            }
            return;
        case 'localRemoved':
            if (isStoredLocalFavoriteKind(change.kind)) {
                favorites.removeLocalFavorite({
                    kind: change.kind,
                    entityId: change.entityId,
                    groupId: change.groupId
                });
            }
            return;
        case 'localGroupCreated':
            favorites.createLocalFavoriteGroup(change.group);
            return;
        case 'localGroupRenamed':
            if (isStoredLocalFavoriteKind(change.kind)) {
                favorites.renameLocalFavoriteGroup({
                    kind: change.kind,
                    groupId: change.groupId,
                    name: change.name
                });
            }
            return;
        case 'localGroupDeleted':
            if (isStoredLocalFavoriteKind(change.kind)) {
                favorites.deleteLocalFavoriteGroup({
                    kind: change.kind,
                    groupId: change.groupId
                });
            }
            return;
        case 'remoteAdded':
            if (isRecord(change.favorite)) {
                favorites.addRemoteFavorite(change.favorite);
            }
            return;
        case 'remoteRemoved':
            favorites.removeRemoteFavorite(change.objectId);
    }
}

function matchesCurrentFavoriteAuthScope(
    payload: FavoritesChangedEventPayload
): boolean {
    const auth = useRuntimeStore.getState().auth;
    return (
        payload.ownerUserId.trim() === (auth.currentUserId ?? '').trim() &&
        normalizeVrchatEndpointDomain(payload.endpoint) ===
            normalizeVrchatEndpointDomain(auth.currentUserEndpoint)
    );
}

function isFavoriteMirrorReady(payload: FavoritesChangedEventPayload): boolean {
    const favorites = useFavoriteStore.getState();
    return (
        favorites.loadStatus === 'ready' &&
        payload.ownerUserId.trim() === (favorites.currentUserId ?? '').trim()
    );
}

function applyFavoritesChangedEvent(
    payload: FavoritesChangedEventPayload
): void {
    void commands.appQuickSearchWorkingSetInvalidate().catch((error) => {
        console.warn(
            'Failed to invalidate the quick search working set:',
            error
        );
    });
    for (const change of payload.changes) {
        applyFavoriteChange(change);
    }
    const kind = payload.kind;
    useFavoriteRevisionStore.getState().bumpRevision({
        kind,
        local: payload.local,
        remote: payload.remote,
        requiresRefresh: payload.requiresRefresh
    });
    if (!payload.local || !payload.requiresRefresh) {
        return;
    }
    const kinds: FavoriteKind[] =
        kind === 'unknown' ? ['friend', 'world', 'avatar'] : [kind];
    refreshLocalFavoritesForKinds(kinds).catch((error: unknown) => {
        console.warn('Failed to refresh local favorites after change:', error);
    });
}

function enqueuePendingFavoritesChangedEvent(
    payload: FavoritesChangedEventPayload
): void {
    if (
        pendingFavoritesChangedEvents.length <
        MAX_PENDING_FAVORITES_CHANGED_EVENTS
    ) {
        pendingFavoritesChangedEvents.push(payload);
        return;
    }

    const events = [...pendingFavoritesChangedEvents, payload];
    const firstKind = events[0]?.kind ?? 'unknown';
    pendingFavoritesChangedEvents = [
        {
            ownerUserId: payload.ownerUserId,
            endpoint: payload.endpoint,
            kind: events.every((event) => event.kind === firstKind)
                ? firstKind
                : 'unknown',
            local: events.some((event) => event.local),
            remote: events.some((event) => event.remote),
            changes: [],
            requiresRefresh: true
        }
    ];
}

function flushPendingFavoritesChangedEvents(): void {
    if (
        flushingFavoritesChangedEvents ||
        !pendingFavoritesChangedEvents.length
    ) {
        return;
    }
    flushingFavoritesChangedEvents = true;
    try {
        const retained: FavoritesChangedEventPayload[] = [];
        for (const payload of pendingFavoritesChangedEvents) {
            if (!matchesCurrentFavoriteAuthScope(payload)) {
                continue;
            }
            if (!isFavoriteMirrorReady(payload)) {
                retained.push(payload);
                continue;
            }
            applyFavoritesChangedEvent(payload);
        }
        pendingFavoritesChangedEvents = retained;
    } finally {
        flushingFavoritesChangedEvents = false;
    }
}

export function resetFavoritesChangedEventDelivery(): void {
    pendingFavoritesChangedEvents = [];
    flushingFavoritesChangedEvents = false;
}

export function handlePrintCleanupEvent(event: PrintAutoCleanupEvent): void {
    usePrintFavoriteStore.getState().applyPrintCleanup(event);
    refreshPrintFavoritesAfterCleanup();
    showPrintCleanupToast(event);
}

export function handleFavoritesChangedEvent(
    payload: FavoritesChangedEventPayload
): void {
    if (!matchesCurrentFavoriteAuthScope(payload)) {
        return;
    }
    if (!isFavoriteMirrorReady(payload)) {
        enqueuePendingFavoritesChangedEvent(payload);
        return;
    }
    applyFavoritesChangedEvent(payload);
}

useFavoriteStore.subscribe(flushPendingFavoritesChangedEvents);
useRuntimeStore.subscribe(flushPendingFavoritesChangedEvents);

export function handleRuntimeGroupInstancesProjection(
    record: RuntimeGroupInstancesProjection
): void {
    const runtimeStore = useRuntimeStore.getState();
    const status = record.status;
    const userId = record.userId.trim();
    const endpoint = record.endpoint.trim();
    const auth = runtimeStore.auth;
    const currentUserId = (auth.currentUserId ?? '').trim();
    const currentEndpoint = auth.currentUserEndpoint.trim();
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
    const instances = record.instances ?? undefined;
    const groupOrder = record.groupOrder ?? undefined;
    const patch: Partial<ReturnType<typeof createGroupInstancesState>> = {
        status,
        userId: currentUserId,
        endpoint: currentEndpoint,
        lastLoadedAt: new Date().toISOString(),
        error: (record.error ?? '').trim()
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

let inFlightGroupInstancesRefresh: Promise<void> | null = null;

export function requestGroupInstancesRefresh(source: string): Promise<void> {
    inFlightGroupInstancesRefresh ??= commands
        .appRuntimeGroupInstancesRefresh()
        .then(() => undefined)
        .catch((error: unknown) => {
            console.warn(
                `Runtime group instances refresh failed during ${source}:`,
                error
            );
        })
        .finally(() => {
            inFlightGroupInstancesRefresh = null;
        });
    return inFlightGroupInstancesRefresh;
}
