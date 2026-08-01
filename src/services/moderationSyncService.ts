import { commands } from '@/platform/tauri/bindings';
import type {
    ModerationSyncMutationOutput as ModerationSyncUpdateResult,
    ModerationSyncRefreshOutput as ModerationSyncRefreshResult
} from '@/platform/tauri/bindings';
import { createRequestError } from '@/repositories/vrchatRequest';

interface ModerationSyncRefreshInput {
    userId: string;
    endpoint?: string;
}

interface ModerationSyncUpdateInput {
    ownerUserId?: string;
    endpoint?: string;
    targetUserId: string;
    targetDisplayName?: string;
    type: string;
    enabled: boolean;
}

export interface ModerationSyncChange {
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

function messageFromError(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}

function normalizeModerationError(error: unknown, path: string): unknown {
    const message = messageFromError(error);
    if (message.includes('Missing Credentials')) {
        return createRequestError(message, 401, path, error);
    }
    return error;
}

function routeModerationAuthFailure(error: unknown, path: string): never {
    const normalizedError = normalizeModerationError(error, path);
    throw normalizedError;
}

export async function refreshModerationSync(
    input: ModerationSyncRefreshInput
): Promise<ModerationSyncRefreshResult> {
    try {
        const result = await commands.appModerationSyncRefresh(input);
        publishModerationSyncChange({ ownerUserId: result.userId });
        return result;
    } catch (error) {
        return routeModerationAuthFailure(error, 'auth/user/playermoderations');
    }
}

export async function updateModerationSync(
    input: ModerationSyncUpdateInput
): Promise<ModerationSyncUpdateResult> {
    try {
        const result = await commands.appModerationSyncUpdate(input);
        publishModerationSyncChange({
            ownerUserId: input.ownerUserId || ''
        });
        return result;
    } catch (error) {
        return routeModerationAuthFailure(
            error,
            input.enabled
                ? 'auth/user/playermoderations'
                : 'auth/user/unplayermoderate'
        );
    }
}
