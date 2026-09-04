import {
    commands,
    type FavoriteEntityKind as FavoriteImportKind,
    type FavoriteImportOperation,
    type FavoriteImportStatus,
    type FavoriteImportTarget,
    type VrchatFavoriteType
} from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import { isRecord } from '@/shared/utils/record';
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
interface FavoriteTypeConfig {
    label: string;
    regex: RegExp;
    remoteGroupsKey: FavoriteRemoteGroupsKey;
}

const TYPE_CONFIG: Record<FavoriteImportKind, FavoriteTypeConfig> = {
    avatar: {
        label: 'Avatar',
        regex: /avtr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteAvatarGroups'
    },
    world: {
        label: 'World',
        regex: /wrld_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteWorldGroups'
    },
    friend: {
        label: 'Friend',
        regex: /usr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteFriendGroups'
    }
};

function normalizeFavoriteType(
    type: unknown,
    fallback: FavoriteImportKind
): VrchatFavoriteType {
    return type === 'avatar' ||
        type === 'world' ||
        type === 'vrcPlusWorld' ||
        type === 'friend'
        ? type
        : fallback;
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

function getRemoteFavoriteGroups(type: FavoriteImportKind | null) {
    if (!type) {
        return [];
    }
    const config = TYPE_CONFIG[type];
    return useFavoriteStore.getState()[config.remoteGroupsKey];
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

interface FavoriteImportWatcher {
    runId: string;
    sessionId: number;
    type: FavoriteImportKind;
    appliedItems: number;
    resolve: (status: FavoriteImportStatus) => void;
}

let favoriteImportWatcher: FavoriteImportWatcher | null = null;
let pendingFavoriteImportStatus: FavoriteImportStatus | null = null;
let favoriteImportStatusEventRevision = 0;

function dismissFavoriteImportStatus(status: FavoriteImportStatus): void {
    if (!status.runId || isBackendActive(status)) {
        return;
    }
    void commands.appFavoriteImportDismiss(status.runId).catch((error) => {
        console.warn('Failed to dismiss favorite import result:', error);
    });
}

function requestFavoriteImportCancel(): void {
    void commands
        .appFavoriteImportCancel()
        .then(dismissFavoriteImportStatus)
        .catch((error: unknown) => {
            console.warn('Failed to cancel favorite import:', error);
        });
}

export function handleFavoriteImportStatusEvent(
    status: FavoriteImportStatus
): void {
    favoriteImportStatusEventRevision += 1;
    const watcher = favoriteImportWatcher;
    if (!watcher || status.runId !== watcher.runId) {
        pendingFavoriteImportStatus =
            status.runId && isBackendActive(status) ? status : null;
        if (status.runId && !isBackendActive(status)) {
            dismissFavoriteImportStatus(status);
        }
        return;
    }
    if (!isActiveDialogSession(watcher.sessionId, watcher.type)) {
        favoriteImportWatcher = null;
        commands
            .appFavoriteImportCancel()
            .then((cancelledStatus) => {
                dismissFavoriteImportStatus(cancelledStatus);
                watcher.resolve(cancelledStatus);
            })
            .catch(() => watcher.resolve(status));
        return;
    }
    setProgress(status.operation, status.processed, status.total);
    watcher.appliedItems = applyFavoriteImportItems(
        watcher.type,
        status.operation,
        status.items,
        watcher.appliedItems
    );
    if (!isBackendActive(status)) {
        favoriteImportWatcher = null;
        dismissFavoriteImportStatus(status);
        watcher.resolve(status);
    }
}

function attachPendingFavoriteImportStatus(): void {
    const status = pendingFavoriteImportStatus;
    if (!status?.runId) {
        return;
    }
    if (!isBackendActive(status)) {
        pendingFavoriteImportStatus = null;
        dismissFavoriteImportStatus(status);
        return;
    }
    const state = useFavoriteImportStore.getState();
    if (!state.open || state.type !== status.kind) {
        return;
    }
    const authScopeGeneration =
        useRuntimeStore.getState().authenticatedSession.session
            ?.authScopeGeneration;
    if (authScopeGeneration !== status.authScopeGeneration) {
        pendingFavoriteImportStatus = null;
        requestFavoriteImportCancel();
        return;
    }
    pendingFavoriteImportStatus = null;
    state.setLoading(true);
    favoriteImportWatcher = {
        runId: status.runId,
        sessionId: state.sessionId,
        type: status.kind,
        appliedItems: 0,
        resolve: (terminalStatus) => {
            void finishResumedFavoriteImport(
                terminalStatus,
                state.sessionId,
                status.kind
            );
        }
    };
    handleFavoriteImportStatusEvent(status);
}

export async function hydrateFavoriteImportRuntimeStatus(): Promise<void> {
    const eventRevision = favoriteImportStatusEventRevision;
    const status = await commands.appFavoriteImportStatus();
    if (favoriteImportStatusEventRevision === eventRevision) {
        pendingFavoriteImportStatus =
            status.runId && isBackendActive(status) ? status : null;
        if (status.runId && !isBackendActive(status)) {
            dismissFavoriteImportStatus(status);
        }
    }
    attachPendingFavoriteImportStatus();
}

function waitForFavoriteImport(
    initialStatus: FavoriteImportStatus,
    sessionId: number,
    type: FavoriteImportKind
): Promise<FavoriteImportStatus> {
    return new Promise<FavoriteImportStatus>((resolve) => {
        pendingFavoriteImportStatus = null;
        favoriteImportWatcher = {
            runId: initialStatus.runId,
            sessionId,
            type,
            appliedItems: 0,
            resolve
        };
        handleFavoriteImportStatusEvent(initialStatus);
    });
}

async function finishResumedFavoriteImport(
    status: FavoriteImportStatus,
    sessionId: number,
    type: FavoriteImportKind
): Promise<void> {
    if (!isActiveDialogSession(sessionId, type)) {
        return;
    }
    const store = useFavoriteImportStore.getState();
    if (status.status === 'error' && status.lastError) {
        store.appendError(buildError(type, '', status.lastError));
    }
    store.setLoading(false);
    setProgress(status.operation, 0, 0);
    await completeFavoriteImport(status, sessionId, type);
}

async function completeFavoriteImport(
    status: FavoriteImportStatus,
    sessionId: number,
    type: FavoriteImportKind
): Promise<void> {
    if (
        status.operation !== 'import' ||
        status.succeeded === 0 ||
        !isActiveDialogSession(sessionId, type)
    ) {
        return;
    }
    await refreshFavoritesSnapshot();
    if (!isActiveDialogSession(sessionId, type)) {
        return;
    }
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

function applyFavoriteImportItems(
    type: FavoriteImportKind,
    operation: FavoriteImportOperation,
    items: FavoriteImportStatus['items'],
    fromIndex: number
): number {
    const store = useFavoriteImportStore.getState();
    for (let index = fromIndex; index < items.length; index += 1) {
        const item = items[index];
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
    return items.length;
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
        if (
            isActiveDialogSession(sessionId, type) &&
            status.status === 'error' &&
            status.lastError
        ) {
            useFavoriteImportStore
                .getState()
                .appendError(buildError(type, '', status.lastError));
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
    type: FavoriteImportKind;
    input?: string;
}): void {
    const normalizedInput = normalizeString(input);
    useFavoriteImportStore.getState().openDialog({
        type,
        input: normalizedInput
    });
    attachPendingFavoriteImportStatus();
    if (normalizedInput) {
        void processFavoriteImportList();
    }
}

export async function processFavoriteImportList(): Promise<void> {
    const store = useFavoriteImportStore.getState();
    const type = store.type;
    const existingIds = new Set(store.rows.map((row) => row.id));
    const ids = extractIds(type, store.input).filter(
        (id) => !existingIds.has(id)
    );
    const sessionId = store.sessionId;
    store.setErrors('');
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
    const type = state.type;
    if (state.rows.length === 0) {
        return;
    }
    const remoteGroups = getRemoteFavoriteGroups(type);
    const remoteGroup = state.remoteGroupName
        ? remoteGroups.find((group) => group.name === state.remoteGroupName) ||
          null
        : null;
    const target: FavoriteImportTarget | null = remoteGroup
        ? {
              location: 'remote',
              group: remoteGroup.name,
              favoriteType: normalizeFavoriteType(remoteGroup.type, type)
          }
        : state.localGroupName
          ? {
                location: 'local',
                group: state.localGroupName,
                favoriteType: null
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
    await completeFavoriteImport(status, sessionId, type);
}

export function clearFavoriteImportRows(): void {
    useFavoriteImportStore.getState().clearRows();
}

export function cancelFavoriteImport(): void {
    useFavoriteImportStore.getState().cancelActiveWork();
    requestFavoriteImportCancel();
}

export function closeFavoriteImportDialog(): void {
    pendingFavoriteImportStatus = null;
    useFavoriteImportStore.getState().closeDialog();
    requestFavoriteImportCancel();
}

export function getFavoriteImportTypeConfig(type: FavoriteImportKind) {
    return TYPE_CONFIG[type];
}
