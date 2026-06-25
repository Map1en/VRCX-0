import { commands } from '@/platform/tauri/bindings';
import type {
    GroupQuickModerationActionOutput,
    GroupQuickModerationOutput
} from '@/platform/tauri/bindings';
import { createRequestError } from '@/repositories/vrchatRequest';

import { handleRuntimeAuthFailure } from './authSessionRecoveryService';

export type GroupQuickModerationAction = 'kick' | 'ban';

interface GroupQuickModerationInput {
    currentUserId: string;
    targetUserId: string;
    endpoint?: string;
}

interface GroupQuickModerationActionInput extends GroupQuickModerationInput {
    groupId: string;
    action: GroupQuickModerationAction;
}

function messageFromError(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}

function normalizeGroupQuickModerationError(
    error: unknown,
    path: string
): unknown {
    const message = messageFromError(error);
    if (message.includes('Missing Credentials')) {
        return createRequestError(message, 401, path, error);
    }
    return error;
}

function routeGroupQuickModerationAuthFailure(
    error: unknown,
    path: string
): never {
    const normalizedError = normalizeGroupQuickModerationError(error, path);
    const handled = handleRuntimeAuthFailure(normalizedError);
    if (handled) {
        handled.catch((recoveryError: unknown) => {
            console.warn(
                'Backend group moderation auth failure recovery failed:',
                recoveryError
            );
        });
    }
    throw normalizedError;
}

function groupQuickModerationActionPath(
    input: GroupQuickModerationActionInput
): string {
    const groupId = encodeURIComponent(input.groupId);
    const targetUserId = encodeURIComponent(input.targetUserId);
    switch (input.action) {
        case 'ban':
            return `groups/${groupId}/bans`;
        case 'kick':
            return `groups/${groupId}/members/${targetUserId}`;
    }
}

export async function getGroupQuickModeration(
    input: GroupQuickModerationInput
): Promise<GroupQuickModerationOutput> {
    try {
        return await commands.appUserGroupQuickModerationGet(input);
    } catch (error) {
        return routeGroupQuickModerationAuthFailure(
            error,
            `users/${encodeURIComponent(input.currentUserId)}/groups`
        );
    }
}

export async function runGroupQuickModerationAction(
    input: GroupQuickModerationActionInput
): Promise<GroupQuickModerationActionOutput> {
    try {
        return await commands.appUserGroupQuickModerationAction(input);
    } catch (error) {
        return routeGroupQuickModerationAuthFailure(
            error,
            groupQuickModerationActionPath(input)
        );
    }
}
