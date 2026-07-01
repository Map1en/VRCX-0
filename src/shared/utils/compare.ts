import { sortStatus } from './friendStatus';

type ComparableFieldValue = string | number | undefined;

type ComparableRef = Record<string, ComparableFieldValue> & {
    $online_for?: ComparableFieldValue;
    last_activity?: ComparableFieldValue;
    last_login?: ComparableFieldValue;
    location?: string;
    state?: string;
    status?: string;
};

type ComparableRecord = Record<string, unknown> & {
    $friendNumber?: number;
    $lastSeen?: ComparableFieldValue;
    $location_at?: ComparableFieldValue;
    $online_for?: ComparableFieldValue;
    created_at?: string;
    displayName?: string;
    id?: string;
    last_activity?: ComparableFieldValue;
    last_login?: ComparableFieldValue;
    location?: string;
    memberCount?: number;
    name?: string;
    ref?: ComparableRef;
    state?: string;
    updated_at?: string;
};
type Comparator = (a: ComparableRecord, b: ComparableRecord) => number;

// Mirrors JS `<` semantics for possibly-undefined operands: any comparison
// involving `undefined` is false, so it ranks the value as "not lower".
function isLessThan(a: ComparableFieldValue, b: ComparableFieldValue): boolean {
    if (a === undefined || b === undefined) {
        return false;
    }
    return a < b;
}

function isGreaterThan(
    a: ComparableFieldValue,
    b: ComparableFieldValue
): boolean {
    if (a === undefined || b === undefined) {
        return false;
    }
    return a > b;
}

function compareByName(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.name !== 'string' || typeof b.name !== 'string') {
        return 0;
    }
    return a.name.localeCompare(b.name);
}

function compareByCreatedAt(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.created_at !== 'string' || typeof b.created_at !== 'string') {
        return 0;
    }
    const A = a.created_at.toUpperCase();
    const B = b.created_at.toUpperCase();
    if (A < B) {
        return 1;
    }
    if (A > B) {
        return -1;
    }
    return 0;
}

function compareByCreatedAtAscending(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (typeof a.created_at !== 'string' || typeof b.created_at !== 'string') {
        return 0;
    }
    const A = a.created_at;
    const B = b.created_at;
    if (A < B) {
        return -1;
    }
    if (A > B) {
        return 1;
    }
    return 0;
}

function compareByUpdatedAt(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.updated_at !== 'string' || typeof b.updated_at !== 'string') {
        return 0;
    }
    const A = a.updated_at.toUpperCase();
    const B = b.updated_at.toUpperCase();
    if (A < B) {
        return 1;
    }
    if (A > B) {
        return -1;
    }
    return 0;
}

function compareByDisplayName(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (
        typeof a.displayName !== 'string' ||
        typeof b.displayName !== 'string'
    ) {
        return 0;
    }
    return a.displayName.localeCompare(b.displayName);
}

function compareById(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.id !== 'string' || typeof b.id !== 'string') {
        return 0;
    }
    return a.id.localeCompare(b.id);
}

function compareByMemberCount(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (
        typeof a.memberCount !== 'number' ||
        typeof b.memberCount !== 'number'
    ) {
        return 0;
    }
    return a.memberCount - b.memberCount;
}

function compareByPrivate(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.ref === 'undefined' || typeof b.ref === 'undefined') {
        return 0;
    }
    if (a.ref.location === 'private' && b.ref.location === 'private') {
        return 0;
    } else if (a.ref.location === 'private') {
        return 1;
    } else if (b.ref.location === 'private') {
        return -1;
    }
    return 0;
}

function compareByStatus(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.ref === 'undefined' || typeof b.ref === 'undefined') {
        return 0;
    }
    const aOffline = a.ref.state === 'offline';
    const bOffline = b.ref.state === 'offline';
    if (aOffline && !bOffline) {
        return 1;
    }
    if (!aOffline && bOffline) {
        return -1;
    }
    if (a.ref.status === b.ref.status) {
        return 0;
    }
    return sortStatus(a.ref.status ?? '', b.ref.status ?? '');
}

function compareByLastActive(a: ComparableRecord, b: ComparableRecord): number {
    if (a.state === 'online' && b.state === 'online') {
        if (
            a.ref?.$online_for &&
            b.ref?.$online_for &&
            a.ref.$online_for === b.ref.$online_for
        ) {
            return compareByActivityField(a, b, 'last_login');
        }
        return compareByActivityField(a, b, '$online_for');
    }

    return compareByActivityField(a, b, 'last_activity');
}

function compareByLastActiveRef(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (a.state === 'online' && b.state === 'online') {
        if (a.$online_for && b.$online_for && a.$online_for === b.$online_for) {
            return isLessThan(a.last_login, b.last_login) ? 1 : -1;
        }
        return isLessThan(a.$online_for, b.$online_for) ? 1 : -1;
    }
    return isLessThan(a.last_activity, b.last_activity) ? 1 : -1;
}

function compareByLastSeen(a: ComparableRecord, b: ComparableRecord): number {
    return compareByActivityField(a, b, '$lastSeen');
}

function compareByActivityField(
    a: ComparableRecord,
    b: ComparableRecord,
    field: string
): number {
    if (typeof a.ref === 'undefined' || typeof b.ref === 'undefined') {
        return 0;
    }

    // When the field is just and empty string, it means they've been
    // in whatever active state for the longest
    if (
        isLessThan(a.ref[field], b.ref[field]) ||
        (a.ref[field] !== '' && b.ref[field] === '')
    ) {
        return 1;
    }
    if (
        isGreaterThan(a.ref[field], b.ref[field]) ||
        (a.ref[field] === '' && b.ref[field] !== '')
    ) {
        return -1;
    }
    return 0;
}

function compareByLocationAt(a: ComparableRecord, b: ComparableRecord): number {
    if (a.location === 'traveling' && b.location === 'traveling') {
        return 0;
    }
    if (a.location === 'traveling') {
        return 1;
    }
    if (b.location === 'traveling') {
        return -1;
    }
    if (isLessThan(a.$location_at, b.$location_at)) {
        return -1;
    }
    if (isGreaterThan(a.$location_at, b.$location_at)) {
        return 1;
    }
    return 0;
}

function compareByLocation(a: ComparableRecord, b: ComparableRecord): number {
    if (typeof a.ref === 'undefined' || typeof b.ref === 'undefined') {
        return 0;
    }
    if (a.state !== 'online' || b.state !== 'online') {
        return 0;
    }

    return (a.ref.location ?? '').localeCompare(b.ref.location ?? '');
}

function compareByFriendOrder(
    a: ComparableRecord,
    b: ComparableRecord
): number {
    if (typeof a === 'undefined' || typeof b === 'undefined') {
        return 0;
    }
    return (b.$friendNumber ?? NaN) - (a.$friendNumber ?? NaN);
}

export {
    compareByName,
    compareByCreatedAt,
    compareByCreatedAtAscending,
    compareByUpdatedAt,
    compareByDisplayName,
    compareById,
    compareByMemberCount,
    compareByPrivate,
    compareByStatus,
    compareByLastActive,
    compareByLastActiveRef,
    compareByLastSeen,
    compareByLocationAt,
    compareByLocation,
    compareByFriendOrder
};
export type { ComparableRecord, Comparator };
