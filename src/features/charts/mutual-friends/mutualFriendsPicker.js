import {
    isValidMutualFriendId,
    MUTUAL_GRAPH_PICKER_RESULT_LIMIT,
    normalizeMutualFriendId
} from './mutualFriendsSettings.js';

export function truncateMutualFriendLabel(value, maxLength = 18) {
    const text = String(value || '');
    return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function mutualFriendPickerOptionMatches(option, query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
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
        .every((token) => text.includes(token));
}

export function filterMutualFriendPickerOptions(options, query, limit = MUTUAL_GRAPH_PICKER_RESULT_LIMIT) {
    return (Array.isArray(options) ? options : [])
        .filter((option) => mutualFriendPickerOptionMatches(option, query))
        .slice(0, limit);
}

export function buildMutualFriendPickerOption(userId, friendsById, fallbackName = '', degree = null) {
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

export function buildMutualFriendNodePickerOptions(nodes, friendsById) {
    return (Array.isArray(nodes) ? nodes : [])
        .slice()
        .sort((left, right) => left.label.localeCompare(right.label))
        .map((node) => buildMutualFriendPickerOption(node.id, friendsById, node.label, node.degree))
        .filter(Boolean);
}

export function buildMutualFriendExcludePickerOptions(snapshot, friendsById, currentUserId) {
    const seen = new Set();
    const items = [];

    function pushOption(userId, fallbackName = '') {
        const normalizedId = normalizeMutualFriendId(userId);
        if (
            !isValidMutualFriendId(normalizedId) ||
            normalizedId === currentUserId ||
            seen.has(normalizedId)
        ) {
            return;
        }
        const option = buildMutualFriendPickerOption(normalizedId, friendsById, fallbackName);
        if (option) {
            seen.add(normalizedId);
            items.push(option);
        }
    }

    if (snapshot instanceof Map) {
        snapshot.forEach((mutualIds, friendId) => {
            pushOption(friendId);
            for (const mutualId of Array.isArray(mutualIds) ? mutualIds : []) {
                pushOption(mutualId);
            }
        });
    }

    return items.sort((left, right) => left.label.localeCompare(right.label));
}
