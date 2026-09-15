import { commands } from '@/platform/tauri/bindings';
import type {
    ModerationSyncMutationInput as ModerationSyncUpdateInput,
    ModerationSyncMutationOutput as ModerationSyncUpdateResult,
    ModerationSyncRefreshOutput as ModerationSyncRefreshResult
} from '@/platform/tauri/bindings';

interface ModerationSyncRefreshInput {
    userId: string;
    endpoint?: string;
}

interface ModerationSyncChange {
    ownerUserId: string;
}

type ModerationSyncChangeListener = (change: ModerationSyncChange) => void;

const moderationSyncChangeListeners = new Set<ModerationSyncChangeListener>();

function publishModerationSyncChange(change: ModerationSyncChange): void {
    for (const listener of moderationSyncChangeListeners) {
        try {
            listener(change);
        } catch (error) {
            console.warn('Moderation sync change listener failed:', error);
        }
    }
}

export function subscribeModerationSyncChanges(
    listener: ModerationSyncChangeListener
): () => void {
    moderationSyncChangeListeners.add(listener);
    return () => {
        moderationSyncChangeListeners.delete(listener);
    };
}

export async function refreshModerationSync(
    input: ModerationSyncRefreshInput
): Promise<ModerationSyncRefreshResult> {
    const result = await commands.appModerationSyncRefresh(input);
    publishModerationSyncChange({ ownerUserId: result.userId });
    return result;
}

export async function updateModerationSync(
    input: ModerationSyncUpdateInput
): Promise<ModerationSyncUpdateResult> {
    const result = await commands.appModerationSyncUpdate(input);
    publishModerationSyncChange({
        ownerUserId: result.ownerUserId
    });
    return result;
}
