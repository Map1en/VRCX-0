import {
    commands,
    type FavoriteImportKind,
    type FavoriteImportOperation,
    type FavoriteImportStatus,
    type FavoriteImportTarget
} from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import { windowDelay } from '@/shared/utils/delays';
import { normalizeString } from '@/shared/utils/string';
import { useFavoriteImportStore } from '@/state/favoriteImportStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { bootstrapFavorites } from './favoriteBootstrapService';

type FavoriteRemoteGroupsKey =
    | 'favoriteAvatarGroups'
    | 'favoriteWorldGroups'
    | 'favoriteFriendGroups';
type FavoriteLocalGroupsKey =
    | 'localAvatarFavoriteGroups'
    | 'localWorldFavoriteGroups'
    | 'localFriendFavoriteGroups';

interface FavoriteTypeConfig {
    label: string;
    regex: RegExp;
    remoteGroupsKey: FavoriteRemoteGroupsKey;
    localGroupsKey: FavoriteLocalGroupsKey;
}

const TYPE_CONFIG: Record<FavoriteImportKind, FavoriteTypeConfig> = {
    avatar: {
        label: 'Avatar',
        regex: /avtr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteAvatarGroups',
        localGroupsKey: 'localAvatarFavoriteGroups'
    },
    world: {
        label: 'World',
        regex: /wrld_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteWorldGroups',
        localGroupsKey: 'localWorldFavoriteGroups'
    },
    friend: {
        label: 'Friend',
        regex: /usr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteFriendGroups',
        localGroupsKey: 'localFriendFavoriteGroups'
    }
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeType(type: unknown): FavoriteImportKind | null {
    const normalized = normalizeString(type);
    return normalized === 'avatar' ||
        normalized === 'world' ||
        normalized === 'friend'
        ? normalized
        : null;
}

function getRuntimeAuth() {
    const runtimeState = useRuntimeStore.getState();
    return {
        endpoint: runtimeState.auth.currentUserEndpoint || '',
        currentUserId: runtimeState.auth.currentUserId || '',
        currentUserSnapshot: runtimeState.auth.currentUserSnapshot || null
    };
}

function extractIds(type: FavoriteImportKind, input: unknown): string[] {
    return Array.from(
        new Set(normalizeString(input).match(TYPE_CONFIG[type].regex) || [])
    );
}

function getFavoriteGroups(type: FavoriteImportKind | null) {
    if (!type) {
        return { remoteGroups: [], localGroups: [] };
    }
    const config = TYPE_CONFIG[type];
    const favoriteState = useFavoriteStore.getState();
    return {
        remoteGroups: favoriteState[config.remoteGroupsKey],
        localGroups: favoriteState[config.localGroupsKey]
    };
}

function refreshFavoritesSnapshot() {
    const auth = getRuntimeAuth();
    if (!auth.currentUserId || !auth.currentUserSnapshot) {
        return Promise.resolve();
    }
    return bootstrapFavorites({
        userId: auth.currentUserId,
        endpoint: auth.endpoint,
        currentUserSnapshot: auth.currentUserSnapshot
    }).catch((error: unknown) => {
        console.warn('Failed to refresh favorites after import:', error);
    });
}

function buildError(
    type: FavoriteImportKind,
    id: string,
    error: unknown
): string {
    const message = error instanceof Error ? error.message : String(error);
    const subject = id
        ? `${TYPE_CONFIG[type].label}Id: ${id}`
        : TYPE_CONFIG[type].label;
    return `${subject}\n${message}\n\n`;
}

function isBackendActive(status: FavoriteImportStatus): boolean {
    return status.status === 'running' || status.status === 'cancelling';
}

function isActiveDialogSession(
    sessionId: number,
    type: FavoriteImportKind
): boolean {
    const state = useFavoriteImportStore.getState();
    return state.type === type && state.sessionId === sessionId;
}

function setProgress(
    operation: FavoriteImportOperation,
    processed: number,
    total: number
): void {
    const state = useFavoriteImportStore.getState();
    if (operation === 'hydrate') {
        state.setProgress(processed, total);
    } else {
        state.setImportProgress(processed, total);
    }
}

async function waitForFavoriteImport(
    initialStatus: FavoriteImportStatus,
    sessionId: number,
    type: FavoriteImportKind
): Promise<FavoriteImportStatus> {
    let status = initialStatus;
    while (status.runId === initialStatus.runId && isBackendActive(status)) {
        if (!isActiveDialogSession(sessionId, type)) {
            return commands.appFavoriteImportCancel();
        }
        setProgress(status.operation, status.processed, status.total);
        await windowDelay(100);
        status = await commands.appFavoriteImportStatus();
    }
    return status;
}

function applyFavoriteImportResults(
    type: FavoriteImportKind,
    operation: FavoriteImportOperation,
    status: FavoriteImportStatus
): void {
    const store = useFavoriteImportStore.getState();
    for (const item of status.items) {
        if (item.state === 'failed') {
            store.appendError(buildError(type, item.id, item.message));
            continue;
        }
        if (operation === 'hydrate') {
            store.addRow({
                ...(isRecord(item.entity) ? item.entity : {}),
                id: item.id
            });
        } else {
            store.removeRow(item.id);
        }
    }
    if (status.status === 'error' && status.lastError) {
        store.appendError(buildError(type, '', status.lastError));
    }
}

function appendFavoriteImportError(
    type: FavoriteImportKind,
    sessionId: number,
    error: unknown
): void {
    if (isActiveDialogSession(sessionId, type)) {
        useFavoriteImportStore
            .getState()
            .appendError(buildError(type, '', error));
    }
}

async function runFavoriteImport({
    type,
    operation,
    ids,
    target,
    sessionId
}: {
    type: FavoriteImportKind;
    operation: FavoriteImportOperation;
    ids: string[];
    target: FavoriteImportTarget | null;
    sessionId: number;
}): Promise<FavoriteImportStatus> {
    const store = useFavoriteImportStore.getState();
    store.setLoading(true);
    setProgress(operation, 0, ids.length);
    try {
        const initialStatus = await commands.appFavoriteImportStart({
            kind: type,
            operation,
            ids,
            target
        });
        const status = await waitForFavoriteImport(
            initialStatus,
            sessionId,
            type
        );
        if (isActiveDialogSession(sessionId, type)) {
            applyFavoriteImportResults(type, operation, status);
        }
        return status;
    } finally {
        if (isActiveDialogSession(sessionId, type)) {
            const current = useFavoriteImportStore.getState();
            current.setLoading(false);
            setProgress(operation, 0, 0);
        }
    }
}

export function openFavoriteImportDialog({
    type,
    input = ''
}: {
    type?: unknown;
    input?: unknown;
} = {}): void {
    const normalizedType = normalizeType(type);
    if (!normalizedType) {
        throw new Error(`Unsupported favorite import type: ${type}`);
    }
    useFavoriteImportStore.getState().openDialog({
        type: normalizedType,
        input
    });
    if (normalizeString(input)) {
        void processFavoriteImportList();
    }
}

export async function processFavoriteImportList(): Promise<void> {
    const store = useFavoriteImportStore.getState();
    const type = normalizeType(store.type);
    if (!type) {
        return;
    }
    const existingIds = new Set(store.rows.map((row) => row.id));
    const ids = extractIds(type, store.input).filter(
        (id) => !existingIds.has(id)
    );
    const sessionId = store.sessionId;
    store.setErrors('');
    store.setInput('');
    if (!ids.length) {
        store.setProgress(0, 0);
        return;
    }
    try {
        await runFavoriteImport({
            type,
            operation: 'hydrate',
            ids,
            target: null,
            sessionId
        });
    } catch (error) {
        appendFavoriteImportError(type, sessionId, error);
    }
}

export async function importFavoriteImportRows(): Promise<void> {
    const state = useFavoriteImportStore.getState();
    const type = normalizeType(state.type);
    if (!type || state.rows.length === 0) {
        return;
    }
    const { remoteGroups } = getFavoriteGroups(type);
    const remoteGroup = state.remoteGroupName
        ? remoteGroups.find((group) => group.name === state.remoteGroupName) ||
          null
        : null;
    const target: FavoriteImportTarget | null = remoteGroup
        ? {
              location: 'remote',
              group: remoteGroup.name,
              favoriteType: remoteGroup.type || type
          }
        : state.localGroupName
          ? {
                location: 'local',
                group: state.localGroupName,
                favoriteType: ''
            }
          : null;
    if (!target) {
        return;
    }
    const sessionId = state.sessionId;
    let status: FavoriteImportStatus;
    try {
        status = await runFavoriteImport({
            type,
            operation: 'import',
            ids: state.rows.map((row) => row.id),
            target,
            sessionId
        });
    } catch (error) {
        appendFavoriteImportError(type, sessionId, error);
        return;
    }
    if (!isActiveDialogSession(sessionId, type)) {
        return;
    }
    if (status.succeeded > 0) {
        await refreshFavoritesSnapshot();
        if (isActiveDialogSession(sessionId, type)) {
            useNotificationStore.getState().pushNotification({
                level: 'success',
                title: i18n.t(
                    'service.favorite_import_service.dynamic.value_import_complete',
                    { value: TYPE_CONFIG[type].label }
                ),
                message: i18n.t(
                    'service.favorite_import_service.dynamic.value_item_s_imported',
                    { value: status.succeeded }
                )
            });
        }
    }
}

export function clearFavoriteImportRows(): void {
    useFavoriteImportStore.getState().clearRows();
}

export function cancelFavoriteImport(): void {
    useFavoriteImportStore.getState().cancelActiveWork();
    void commands.appFavoriteImportCancel().catch((error: unknown) => {
        console.warn('Failed to cancel favorite import:', error);
    });
}

export function closeFavoriteImportDialog(): void {
    cancelFavoriteImport();
    useFavoriteImportStore.getState().closeDialog();
}

export function getFavoriteImportTypeConfig(type: unknown) {
    const normalized = normalizeType(type);
    return normalized ? TYPE_CONFIG[normalized] : null;
}

export function getFavoriteImportGroups(type: unknown) {
    return getFavoriteGroups(normalizeType(type));
}
