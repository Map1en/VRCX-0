import { backend } from '@/platform/index.js';

import {
    normalizeUserTablePrefix as baseNormalizeUserTablePrefix
} from './localDatabaseSchema.js';

export interface UserTableContext {
    userId: string;
    userPrefix: string;
}

export interface UserSessionRepository {
    normalizeUserTablePrefix(userId: unknown): string;
    ensureUserTables(userId: unknown): Promise<UserTableContext>;
    getUserTableContext(userId: unknown): Promise<UserTableContext>;
    initUserTables(userId: unknown): Promise<UserTableContext>;
    initUserTablesUncached(userId: unknown): Promise<UserTableContext>;
    purgeAvatarFeedData(
        userId: unknown,
        cutoffDate?: string | null
    ): Promise<void>;
}

const userTableInitPromises = new Map<string, Promise<UserTableContext>>();

function normalizeUserTablePrefix(userId: unknown): string {
    return baseNormalizeUserTablePrefix(userId);
}

function normalizeUserId(userId: unknown): string {
    return typeof userId === 'string'
        ? userId.trim()
        : String(userId ?? '').trim();
}

async function ensureUserTables(userId: unknown): Promise<UserTableContext> {
    const userPrefix = normalizeUserTablePrefix(userId);
    const existing = userTableInitPromises.get(userPrefix);
    if (existing) {
        return existing;
    }

    const promise = (async () => {
        const context = (await backend.app.UserTablesEnsure({
            userId: normalizeUserId(userId)
        })) as UserTableContext;

        return {
            userId: context.userId || normalizeUserId(userId),
            userPrefix: context.userPrefix || userPrefix
        };
    })().catch((error) => {
        if (userTableInitPromises.get(userPrefix) === promise) {
            userTableInitPromises.delete(userPrefix);
        }
        throw error;
    });

    userTableInitPromises.set(userPrefix, promise);
    return promise;
}

async function initUserTables(userId: unknown): Promise<UserTableContext> {
    return ensureUserTables(userId);
}

async function getUserTableContext(userId: unknown): Promise<UserTableContext> {
    return ensureUserTables(userId);
}

async function initUserTablesUncached(
    userId: unknown
): Promise<UserTableContext> {
    const userPrefix = normalizeUserTablePrefix(userId);
    const context = (await backend.app.UserTablesEnsure({
        userId: normalizeUserId(userId)
    })) as UserTableContext;

    return {
        userId: context.userId || normalizeUserId(userId),
        userPrefix: context.userPrefix || userPrefix
    };
}

async function purgeAvatarFeedData(
    userId: unknown,
    cutoffDate: string | null = null
): Promise<void> {
    await backend.app.FeedAvatarPurge({
        userId: normalizeUserId(userId),
        cutoffDate: cutoffDate || null
    });
}

const userSessionRepository: UserSessionRepository = {
    normalizeUserTablePrefix,
    ensureUserTables,
    getUserTableContext,
    initUserTables,
    initUserTablesUncached,
    purgeAvatarFeedData
};

export {
    ensureUserTables,
    getUserTableContext,
    initUserTables,
    initUserTablesUncached,
    normalizeUserTablePrefix,
    purgeAvatarFeedData
};
export default userSessionRepository;
