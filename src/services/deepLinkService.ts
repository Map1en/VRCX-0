import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import type {
    DeepLinkAction,
    SharedCollectionImportStatus
} from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import shareCollectionRepository from '@/repositories/shareCollectionRepository';
import { isCollectionShortcode } from '@/shared/constants/collectionShare';
import { isWorldId } from '@/shared/constants/vrchatIds';
import { useModalStore } from '@/state/modalStore';
import { useWorldCollectionImportStore } from '@/state/worldCollectionImportStore';

import { openWorldDialog } from './dialogService';
import i18n from './i18nService';

const DEEP_LINK_ARRIVED_EVENT = 'deepLinkArrived';
const SHARED_COLLECTION_IMPORT_STATUS_EVENT = 'sharedCollectionImportStatus';
let sharedCollectionImportQueue = Promise.resolve();
const sharedCollectionImportWaiters = new Map<
    string,
    (status: SharedCollectionImportStatus) => void
>();

type DeepLinkEventUnsubscribe = () => void;

export async function bindDeepLinkEvents(): Promise<DeepLinkEventUnsubscribe> {
    const unsubscribes: DeepLinkEventUnsubscribe[] = [];
    try {
        unsubscribes.push(
            await tauriClient.events.subscribe(DEEP_LINK_ARRIVED_EVENT, () => {
                drainPendingDeepLinks().catch(logPendingDeepLinkDrainFailure);
            })
        );
        unsubscribes.push(
            await tauriClient.events.subscribe<SharedCollectionImportStatus>(
                SHARED_COLLECTION_IMPORT_STATUS_EVENT,
                handleSharedCollectionImportStatus
            )
        );
        handleSharedCollectionImportStatus(
            await commands.appSharedCollectionImportStatus()
        );
    } catch (error) {
        for (const unsubscribe of unsubscribes.reverse()) {
            unsubscribe();
        }
        throw error;
    }
    return () => {
        for (const unsubscribe of unsubscribes.reverse()) {
            unsubscribe();
        }
    };
}

export async function drainPendingDeepLinks(): Promise<void> {
    let actions: DeepLinkAction[];
    try {
        actions = await commands.appDrainPendingDeepLinks();
    } catch (error) {
        logPendingDeepLinkDrainFailure(error);
        return;
    }

    for (const action of actions) {
        handleDeepLinkAction(action);
    }
}

export function handleDeepLinkAction(action: DeepLinkAction): void {
    switch (action.type) {
        case 'openWorld':
            if (isWorldId(action.worldId)) {
                openWorldDialog({ worldId: action.worldId });
            } else {
                console.warn(
                    'Ignored deep link with invalid world id:',
                    action.worldId
                );
            }
            break;
        case 'importCollection':
            if (isCollectionShortcode(action.collectionId)) {
                sharedCollectionImportQueue = sharedCollectionImportQueue
                    .then(() => importSharedCollectionFlow(action.collectionId))
                    .catch((error) => {
                        console.warn(
                            'Failed to run shared collection import:',
                            error
                        );
                    });
            } else {
                console.warn(
                    'Ignored deep link with invalid collection id:',
                    action.collectionId
                );
            }
            break;
    }
}

function logPendingDeepLinkDrainFailure(error: unknown): void {
    console.warn('Failed to drain pending deep links:', error);
}

function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === 'string' && error.trim()) {
        return error.trim();
    }
    return fallback;
}

function isTerminalSharedCollectionImport(
    status: SharedCollectionImportStatus
) {
    return (
        status.status === 'completed' ||
        status.status === 'cancelled' ||
        status.status === 'error'
    );
}

function handleSharedCollectionImportStatus(
    status: SharedCollectionImportStatus
): void {
    useWorldCollectionImportStore.getState().hydrate(status);
    if (!isTerminalSharedCollectionImport(status)) {
        return;
    }
    const resolve = sharedCollectionImportWaiters.get(status.runId);
    if (resolve) {
        sharedCollectionImportWaiters.delete(status.runId);
        resolve(status);
    }
}

function waitForSharedCollectionImport(
    runId: string
): Promise<SharedCollectionImportStatus> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (status: SharedCollectionImportStatus) => {
            if (settled) {
                return;
            }
            settled = true;
            sharedCollectionImportWaiters.delete(runId);
            resolve(status);
        };
        sharedCollectionImportWaiters.set(runId, finish);
        commands
            .appSharedCollectionImportStatus()
            .then((status) => {
                handleSharedCollectionImportStatus(status);
                if (
                    status.runId === runId &&
                    isTerminalSharedCollectionImport(status)
                ) {
                    finish(status);
                }
            })
            .catch((error: unknown) => {
                if (!settled) {
                    settled = true;
                    sharedCollectionImportWaiters.delete(runId);
                    reject(error);
                }
            });
    });
}

export async function cancelSharedCollectionImport(): Promise<void> {
    handleSharedCollectionImportStatus(
        await commands.appSharedCollectionImportCancel()
    );
}

async function importSharedCollectionFlow(collectionId: string): Promise<void> {
    let preview;
    try {
        preview =
            await shareCollectionRepository.previewSharedCollection(
                collectionId
            );
    } catch (error) {
        toast.error(
            errorMessage(
                error,
                i18n.t('deep_link.import_collection.toast.preview_failed')
            )
        );
        return;
    }

    const worldCount = preview.worldIds.length;
    if (!worldCount) {
        toast.error(i18n.t('deep_link.import_collection.toast.empty'));
        return;
    }

    const prompt = await useModalStore.getState().prompt({
        title: i18n.t('deep_link.import_collection.prompt.title'),
        description: i18n.t('deep_link.import_collection.prompt.description', {
            count: worldCount
        }),
        inputValue: preview.title || collectionId,
        pattern: /\S/,
        confirmText: i18n.t('deep_link.import_collection.confirm.confirm'),
        cancelText: i18n.t('deep_link.import_collection.confirm.cancel')
    });
    if (!prompt.ok || typeof prompt.value !== 'string') {
        return;
    }
    const groupName = prompt.value.trim();
    if (!groupName) {
        return;
    }

    try {
        const started = await commands.appSharedCollectionImportStart({
            worldIds: preview.worldIds,
            groupName
        });
        handleSharedCollectionImportStatus(started);
        const result = isTerminalSharedCollectionImport(started)
            ? started
            : await waitForSharedCollectionImport(started.runId);
        if (result.status === 'cancelled') {
            toast.error(
                errorMessage(
                    result.lastError,
                    i18n.t('deep_link.import_collection.toast.import_failed')
                )
            );
            return;
        }
        if (result.status === 'error' || !result.imported) {
            toast.error(
                errorMessage(
                    result.lastError,
                    i18n.t('deep_link.import_collection.toast.import_failed')
                )
            );
            return;
        }
        toast.success(
            i18n.t('deep_link.import_collection.toast.import_success', {
                count: result.imported,
                title: result.groupName
            })
        );
        if (result.failed > 0) {
            toast.error(
                i18n.t(
                    'deep_link.import_collection.toast.import_partial_failed',
                    { count: result.failed }
                )
            );
        }
    } catch (error) {
        toast.error(
            errorMessage(
                error,
                i18n.t('deep_link.import_collection.toast.import_failed')
            )
        );
    }
}
