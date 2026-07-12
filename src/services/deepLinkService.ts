import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import type { DeepLinkAction } from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import shareCollectionRepository from '@/repositories/shareCollectionRepository';
import { isCollectionShortcode } from '@/shared/constants/collectionShare';
import { isWorldId } from '@/shared/constants/vrchatIds';
import { useModalStore } from '@/state/modalStore';

import { openWorldDialog } from './dialogService';
import i18n from './i18nService';

const DEEP_LINK_ARRIVED_EVENT = 'deepLinkArrived';

type DeepLinkEventUnsubscribe = () => void;

export async function bindDeepLinkEvents(): Promise<DeepLinkEventUnsubscribe> {
    const unsubscribe = await tauriClient.events.subscribe(
        DEEP_LINK_ARRIVED_EVENT,
        () => {
            drainPendingDeepLinks().catch(logPendingDeepLinkDrainFailure);
        }
    );
    return unsubscribe;
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
                void importSharedCollectionFlow(action.collectionId);
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
    return error instanceof Error && error.message ? error.message : fallback;
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

    if (!preview.worldCount) {
        toast.error(i18n.t('deep_link.import_collection.toast.empty'));
        return;
    }

    const title = preview.title || collectionId;
    const author =
        preview.authorName ||
        i18n.t('deep_link.import_collection.unknown_author');
    const worldNames = preview.worlds
        .map((world) => world.name)
        .filter((name) => name.trim().length > 0)
        .slice(0, 5)
        .join(', ');
    const baseDescription = i18n.t(
        'deep_link.import_collection.confirm.description',
        {
            title,
            author,
            count: preview.worldCount
        }
    );
    const description = worldNames
        ? [
              baseDescription,
              i18n.t('deep_link.import_collection.confirm.worlds_preview', {
                  names: worldNames
              })
          ].join('\n')
        : baseDescription;

    const confirmation = await useModalStore.getState().confirm({
        title: i18n.t('deep_link.import_collection.confirm.title'),
        description,
        confirmText: i18n.t('deep_link.import_collection.confirm.confirm'),
        cancelText: i18n.t('deep_link.import_collection.confirm.cancel')
    });
    if (!confirmation.ok) {
        return;
    }

    try {
        const result =
            await shareCollectionRepository.importSharedCollection(
                collectionId
            );
        toast.success(
            i18n.t('deep_link.import_collection.toast.import_success', {
                count: result.importedCount,
                title: result.groupKey
            })
        );
    } catch (error) {
        toast.error(
            errorMessage(
                error,
                i18n.t('deep_link.import_collection.toast.import_failed')
            )
        );
    }
}
