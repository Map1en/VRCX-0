import type { UserFact } from '@/domain/users/userFacts';

type FriendRecord = Record<string, unknown>;

const FACT_DERIVED_FIELDS = [
    '$trustLevel',
    '$trustClass',
    '$trustSortNum',
    '$isModerator',
    '$isTroll',
    '$isProbableTroll',
    '$platform'
] as const;

function applyFactDerivedFields(
    friend: FriendRecord,
    fact: UserFact | null | undefined
): FriendRecord {
    if (!fact) {
        return friend;
    }
    let next: FriendRecord | null = null;
    for (const field of FACT_DERIVED_FIELDS) {
        const value = fact[field];
        if (value === undefined || value === null || value === friend[field]) {
            continue;
        }
        if (!next) {
            next = { ...friend };
        }
        next[field] = value;
    }
    return next ?? friend;
}

function mergeRosterFriendFacts(
    friendsById: Record<string, FriendRecord>,
    factsById: Record<string, UserFact>
): Record<string, FriendRecord> {
    let next: Record<string, FriendRecord> | null = null;
    for (const id of Object.keys(friendsById)) {
        const friend = friendsById[id];
        const merged = applyFactDerivedFields(friend, factsById[id]);
        if (merged !== friend) {
            if (!next) {
                next = { ...friendsById };
            }
            next[id] = merged;
        }
    }
    return next ?? friendsById;
}

export { applyFactDerivedFields, mergeRosterFriendFacts };
