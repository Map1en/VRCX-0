import {
    commands,
    type UserTableContextOutput
} from '@/platform/tauri/bindings';

export type UserTableContext = UserTableContextOutput;

export interface UserSessionRepository {
    normalizeUserTablePrefix(userId: unknown): string;
    ensureUserTables(userId: unknown): Promise<UserTableContext>;
    getUserTableContext(userId: unknown): Promise<UserTableContext>;
    initUserTables(userId: unknown): Promise<UserTableContext>;
    initUserTablesUncached(userId: unknown): Promise<UserTableContext>;
}

const userTableInitPromises = new Map<string, Promise<UserTableContext>>();

function normalizeUserTablePrefix(userId: unknown): string {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        throw new Error('User table prefix requires a user id.');
    }

    let userPrefix = normalizedUserId.replaceAll('-', '').replaceAll('_', '');
    if (!/^[A-Za-z0-9]+$/.test(userPrefix)) {
        throw new Error('User table prefix contains invalid characters.');
    }
    if (/^\d/.test(userPrefix)) {
        userPrefix = `_${userPrefix}`;
    }

    return userPrefix;
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
        const context = await commands.appUserTablesEnsure(
            normalizeUserId(userId)
        );

        return {
            userId: context.userId || normalizeUserId(userId),
            userPrefix: context.userPrefix || userPrefix
        };
    })().catch((error: unknown) => {
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
    const context = await commands.appUserTablesEnsure(normalizeUserId(userId));

    return {
        userId: context.userId || normalizeUserId(userId),
        userPrefix: context.userPrefix || userPrefix
    };
}

const userSessionRepository: UserSessionRepository = {
    normalizeUserTablePrefix,
    ensureUserTables,
    getUserTableContext,
    initUserTables,
    initUserTablesUncached
};

export {
    ensureUserTables,
    getUserTableContext,
    initUserTables,
    initUserTablesUncached,
    normalizeUserTablePrefix
};
export default userSessionRepository;
