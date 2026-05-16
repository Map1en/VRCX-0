import { backend } from '@/platform/index.js';
import type {
    BackendModerationRefreshResult,
    BackendModerationUpdateResult
} from '@/platform/tauri/backend.js';
import { createRequestError } from '@/repositories/vrchatRequest.js';

import { handleRuntimeAuthFailure } from './authSessionRecoveryService.js';

interface BackendModerationRefreshInput {
    userId: string;
    endpoint?: string;
}

interface BackendModerationUpdateInput {
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
    const handled = handleRuntimeAuthFailure(normalizedError);
    if (handled) {
        void handled.catch((recoveryError) => {
            console.warn(
                'Backend moderation auth failure recovery failed:',
                recoveryError
            );
        });
    }
    throw normalizedError;
}

export async function refreshBackendModerations(
    input: BackendModerationRefreshInput
): Promise<BackendModerationRefreshResult> {
    try {
        return await backend.app.BackendModerationRefresh(input);
    } catch (error) {
        return routeModerationAuthFailure(
            error,
            'auth/user/playermoderations'
        );
    }
}

export async function updateBackendModeration(
    input: BackendModerationUpdateInput
): Promise<BackendModerationUpdateResult> {
    try {
        return await backend.app.BackendModerationUpdate(input);
    } catch (error) {
        return routeModerationAuthFailure(
            error,
            input.enabled
                ? 'auth/user/playermoderations'
                : 'auth/user/unplayermoderate'
        );
    }
}
