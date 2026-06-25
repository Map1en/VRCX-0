import {
    getKnownUserFact,
    normalizeEndpoint,
    normalizeUserId,
    recordUserProfile
} from '@/domain/users/userFactAccess';
import defaultGameLogRepository from '@/repositories/gameLogRepository';
import defaultVrchatSearchRepository from '@/repositories/vrchatSearchRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

type UserIdentityRecord = Record<string, unknown> & {
    id?: unknown;
    userId?: unknown;
    displayName?: unknown;
    username?: unknown;
    name?: unknown;
    isFriend?: unknown;
    state?: unknown;
    stateBucket?: unknown;
};
type ResolvedUserSource =
    | 'currentUser'
    | 'known'
    | 'friend'
    | 'gameLog'
    | 'search';
type UserIdentityRepositories = {
    gameLogRepository?: {
        getUserIdFromDisplayName?: (displayName: string) => Promise<unknown>;
    };
    vrchatSearchRepository?: {
        getUsers?: (
            params: { search: string; n: number; offset: number },
            options: { endpoint: string }
        ) => Promise<{ json?: unknown }>;
    };
};

function asUserRecord(value: unknown): UserIdentityRecord | null {
    return value && typeof value === 'object'
        ? (value as UserIdentityRecord)
        : null;
}

function text(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function displayNameOf(user: unknown): string {
    const record = asUserRecord(user);
    return text(record?.displayName || record?.username || record?.name);
}

function titleForUser(user: unknown, fallback: any = ''): string {
    const record = asUserRecord(user);
    return (
        displayNameOf(user) ||
        text(fallback) ||
        normalizeUserId(record?.id || record?.userId)
    );
}

function displayNameMatches(user: unknown, targetDisplayName: string): boolean {
    const name = displayNameOf(user).toLowerCase();
    return Boolean(name && name === targetDisplayName);
}

function resolvedEndpoint(endpoint: unknown): string {
    return normalizeEndpoint(
        endpoint || useRuntimeStore.getState().auth.currentUserEndpoint
    );
}

function resolvedUser(
    user: unknown,
    source: ResolvedUserSource,
    fallbackTitle: any = ''
) {
    const record = asUserRecord(user);
    const userId = normalizeUserId(record?.id || record?.userId);
    if (!userId) {
        return null;
    }
    return {
        userId,
        title: titleForUser(user, fallbackTitle),
        user,
        seedData: user,
        source
    };
}

function findKnownUserByDisplayName(
    displayName: unknown,
    { endpoint = '' }: { endpoint?: string } = {}
) {
    const targetDisplayName = text(displayName).toLowerCase();
    if (!targetDisplayName) {
        return null;
    }

    const normalizedEndpoint = resolvedEndpoint(endpoint);
    const state = useUserFactsStore.getState();
    const userIds = state.userIdsByEndpoint[normalizedEndpoint] || [];
    for (const userId of userIds) {
        const fact = getKnownUserFact(normalizedEndpoint, userId);
        if (displayNameMatches(fact, targetDisplayName)) {
            return fact;
        }
    }
    return null;
}

function findFriendByDisplayName(
    displayName: unknown
): UserIdentityRecord | null {
    const targetDisplayName = text(displayName).toLowerCase();
    if (!targetDisplayName) {
        return null;
    }

    const { friendsById } = useFriendRosterStore.getState();
    return (
        (Object.values(friendsById || {}).find((friend: any) =>
            displayNameMatches(friend, targetDisplayName)
        ) as UserIdentityRecord | undefined) || null
    );
}

async function resolveUserByDisplayName(
    displayName: unknown,
    {
        endpoint = '',
        repositories = {},
        search = true
    }: {
        endpoint?: string;
        repositories?: UserIdentityRepositories;
        search?: boolean;
    } = {}
) {
    const normalizedDisplayName = text(displayName);
    if (!normalizedDisplayName) {
        return null;
    }

    const normalizedEndpoint = resolvedEndpoint(endpoint);
    const targetDisplayName = normalizedDisplayName.toLowerCase();
    const runtimeUser = asUserRecord(
        useRuntimeStore.getState().auth.currentUserSnapshot
    );
    if (runtimeUser && displayNameMatches(runtimeUser, targetDisplayName)) {
        recordUserProfile(runtimeUser, {
            endpoint: normalizedEndpoint,
            source: 'currentUser',
            isCurrentUser: true
        });
        return resolvedUser(runtimeUser, 'currentUser', normalizedDisplayName);
    }

    const knownUser = findKnownUserByDisplayName(normalizedDisplayName, {
        endpoint: normalizedEndpoint
    });
    if (knownUser) {
        return resolvedUser(knownUser, 'known', normalizedDisplayName);
    }

    const friend = findFriendByDisplayName(normalizedDisplayName);
    if (friend) {
        recordUserProfile(friend, {
            endpoint: normalizedEndpoint,
            source: 'friend',
            isFriend: true,
            stateBucket: friend.stateBucket || friend.state
        });
        return resolvedUser(friend, 'friend', normalizedDisplayName);
    }

    const gameLog = repositories.gameLogRepository || defaultGameLogRepository;
    const loggedUserId = normalizeUserId(
        gameLog?.getUserIdFromDisplayName
            ? await gameLog
                  .getUserIdFromDisplayName(normalizedDisplayName)
                  .catch(() => '')
            : ''
    );
    if (loggedUserId) {
        const user = asUserRecord(
            getKnownUserFact(normalizedEndpoint, loggedUserId) ||
                useFriendRosterStore.getState().friendsById?.[loggedUserId] || {
                    id: loggedUserId,
                    displayName: normalizedDisplayName
                }
        ) ?? {
            id: loggedUserId,
            displayName: normalizedDisplayName
        };
        recordUserProfile(user, {
            endpoint: normalizedEndpoint,
            source: user.isFriend ? 'friend' : 'seed',
            isFriend: Boolean(user.isFriend)
        });
        return resolvedUser(user, 'gameLog', normalizedDisplayName);
    }

    if (!search) {
        return null;
    }

    const searchRepository =
        repositories.vrchatSearchRepository || defaultVrchatSearchRepository;
    const response = await searchRepository?.getUsers?.(
        {
            search: normalizedDisplayName,
            n: 5,
            offset: 0
        },
        { endpoint: normalizedEndpoint }
    );
    const rows = Array.isArray(response?.json) ? response.json : [];
    const match =
        rows.find((user: any) => displayNameMatches(user, targetDisplayName)) ||
        rows.find(
            (user: any) =>
                normalizeUserId(asUserRecord(user)?.id) ===
                normalizedDisplayName
        );
    const matchRecord = asUserRecord(match);
    if (!matchRecord?.id) {
        return null;
    }

    const recorded =
        recordUserProfile(matchRecord, {
            endpoint: normalizedEndpoint,
            source: 'profile'
        }) || matchRecord;
    return resolvedUser(recorded, 'search', normalizedDisplayName);
}

export { findKnownUserByDisplayName, resolveUserByDisplayName, resolvedUser };
