import { normalizeUserStatus } from '@/shared/utils/userStatus';

export type FriendStatusDistributionKey =
    | 'join-me'
    | 'online'
    | 'ask-me'
    | 'busy';

export type FriendStatusDistributionFriend = {
    status?: unknown;
};

export type FriendStatusDistributionFriendMap = Record<
    string,
    FriendStatusDistributionFriend | null | undefined
>;

export type FriendStatusDistributionEntry = {
    key: FriendStatusDistributionKey;
    status: 'join me' | 'active' | 'ask me' | 'busy';
    cssVariable: string;
    count: number;
    percentage: number;
};

export type FriendStatusDistribution = {
    total: number;
    entries: FriendStatusDistributionEntry[];
};

const FRIEND_STATUS_DISTRIBUTION_DEFINITIONS = Object.freeze([
    {
        key: 'join-me',
        status: 'join me',
        cssVariable: '--status-joinme'
    },
    {
        key: 'online',
        status: 'active',
        cssVariable: '--status-online'
    },
    {
        key: 'ask-me',
        status: 'ask me',
        cssVariable: '--status-askme'
    },
    {
        key: 'busy',
        status: 'busy',
        cssVariable: '--status-busy'
    }
] as const);

function normalizeOnlineFriendId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function distributionKeyForStatus(value: unknown): FriendStatusDistributionKey {
    const status = normalizeUserStatus(value);
    if (status === 'join me') {
        return 'join-me';
    }
    if (status === 'ask me') {
        return 'ask-me';
    }
    if (status === 'busy') {
        return 'busy';
    }

    // `onlineIds` is authoritative for this four-colour chart. VRChat's
    // default/unknown social status uses the same green presentation as
    // `active`, while the separate yellow `activeIds` bucket is excluded.
    return 'online';
}

export function buildFriendStatusDistribution({
    onlineIds = [],
    friendsById = {}
}: {
    onlineIds?: readonly unknown[] | null;
    friendsById?: FriendStatusDistributionFriendMap | null;
}): FriendStatusDistribution {
    const uniqueOnlineIds = new Set<string>();
    for (const value of onlineIds ?? []) {
        const userId = normalizeOnlineFriendId(value);
        if (userId) {
            uniqueOnlineIds.add(userId);
        }
    }

    const counts: Record<FriendStatusDistributionKey, number> = {
        'join-me': 0,
        online: 0,
        'ask-me': 0,
        busy: 0
    };
    const friendMap = friendsById ?? {};

    for (const userId of uniqueOnlineIds) {
        const key = distributionKeyForStatus(friendMap[userId]?.status);
        counts[key] += 1;
    }

    const total = uniqueOnlineIds.size;
    return {
        total,
        entries: FRIEND_STATUS_DISTRIBUTION_DEFINITIONS.map((definition) => {
            const count = counts[definition.key];
            return {
                ...definition,
                count,
                percentage: total > 0 ? (count / total) * 100 : 0
            };
        })
    };
}
