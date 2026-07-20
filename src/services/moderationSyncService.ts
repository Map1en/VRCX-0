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
        return await commands.appModerationSyncRefresh(input);
    } catch (error) {
        return routeModerationAuthFailure(error, 'auth/user/playermoderations');
    }
}

export async function updateModerationSync(
    input: ModerationSyncUpdateInput
): Promise<ModerationSyncUpdateResult> {
    try {
        return await commands.appModerationSyncUpdate(input);
    } catch (error) {
        return routeModerationAuthFailure(
            error,
            input.enabled
                ? 'auth/user/playermoderations'
                : 'auth/user/unplayermoderate'
        );
    }
}
