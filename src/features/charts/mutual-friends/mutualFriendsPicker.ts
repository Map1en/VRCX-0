import {
    isValidMutualFriendId,
    MUTUAL_GRAPH_PICKER_RESULT_LIMIT,
    normalizeMutualFriendId
} from './mutualFriendsSettings';

export function truncateMutualFriendLabel(value: any, maxLength: any = 18) {
    const text = String(value || '');
    return text.length <= maxLength
        ? text
        : `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function mutualFriendPickerOptionMatches(option: any, query: any) {
    const normalizedQuery = String(query || '')
        .trim()
        .toLowerCase();
    if (!normalizedQuery) {
        return true;
    }
    const text = [
        option?.label,
        option?.displayLabel,
        option?.value,
        option?.search,
        option?.user?.displayName,
        option?.user?.username
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return normalizedQuery
        .split(/\s+/)
        .filter(Boolean)
        .every((token: any) => text.includes(token));
}

export function filterMutualFriendPickerOptions(
    options: any,
    query: any,
    limit: any = MUTUAL_GRAPH_PICKER_RESULT_LIMIT,
    selectedIds: any = null
) {
    const selectedIdSet = new Set(
        Array.isArray(selectedIds)
            ? selectedIds.map(normalizeMutualFriendId).filter(Boolean)
            : selectedIds instanceof Set
              ? [...selectedIds].map(normalizeMutualFriendId).filter(Boolean)
              : []
    );

    return (Array.isArray(options) ? options : [])
        .filter((option: any) => mutualFriendPickerOptionMatches(option, query))
        .sort((left: any, right: any) => {
            const leftSelected = selectedIdSet.has(
                normalizeMutualFriendId(left?.value)
            );
            const rightSelected = selectedIdSet.has(
                normalizeMutualFriendId(right?.value)
            );
            if (leftSelected !== rightSelected) {
                return leftSelected ? -1 : 1;
            }
            return 0;
        })
        .slice(0, limit);
}

interface MutualFriendPickerOption {
    value: string;
    label: string;
    displayLabel: string;
    search: string;
    user: any;
    degree: any;
}

export function buildMutualFriendPickerOption(
    userId: any,
    friendsById: any,
    fallbackName: any = '',
    degree: any = null
): MutualFriendPickerOption | null {
    const normalizedId = normalizeMutualFriendId(userId);
    if (!isValidMutualFriendId(normalizedId)) {
        return null;
    }
    const user = friendsById[normalizedId] || null;
    const label = user?.displayName || user?.username || fallbackName || 'User';
    return {
        value: normalizedId,
        label,
        displayLabel: Number.isFinite(degree) ? `${label} (${degree})` : label,
        search: `${label} ${normalizedId}`,
        user,
        degree
    };
}

export function buildMutualFriendNodePickerOptions(
    nodes: any,
    friendsById: any
) {
    return (Array.isArray(nodes) ? nodes : [])
        .slice()
        .sort((left: any, right: any) => left.label.localeCompare(right.label))
        .map((node: any) =>
            buildMutualFriendPickerOption(
                node.id,
                friendsById,
                node.label,
                node.degree
            )
        )
        .filter(Boolean);
}

export function buildMutualFriendExcludePickerOptions(
    snapshot: any,
    friendsById: any,
    currentUserId: any
) {
    const seen = new Set();
    const items: MutualFriendPickerOption[] = [];

    function pushOption(userId: any, fallbackName: any = '') {
        const normalizedId = normalizeMutualFriendId(userId);
        if (
            !isValidMutualFriendId(normalizedId) ||
            normalizedId === currentUserId ||
            seen.has(normalizedId)
        ) {
            return;
        }
        const option = buildMutualFriendPickerOption(
            normalizedId,
            friendsById,
            fallbackName
        );
        if (option) {
            seen.add(normalizedId);
            items.push(option);
        }
    }

    if (snapshot instanceof Map) {
        snapshot.forEach((mutualIds: any, friendId: any) => {
            pushOption(friendId);
            for (const mutualId of Array.isArray(mutualIds) ? mutualIds : []) {
                pushOption(mutualId);
            }
        });
    }

    return items.sort((left: any, right: any) =>
        left.label.localeCompare(right.label)
    );
}
