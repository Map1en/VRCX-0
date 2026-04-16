import {
    isValidMutualFriendId,
    normalizeMutualFriendId
} from './mutualFriendsSettings.js';

export function buildMutualFriendsBaseGraph(snapshot, meta, friendsById, excludedFriendIds = []) {
    const nodeMap = new Map();
    const edgeMap = new Map();
    const metaMap = meta instanceof Map ? meta : new Map();
    const friends = friendsById && typeof friendsById === 'object' ? friendsById : {};
    const excluded = new Set((excludedFriendIds || []).map(normalizeMutualFriendId).filter(Boolean));

    function ensureNode(id) {
        const normalizedId = normalizeMutualFriendId(id);
        if (!isValidMutualFriendId(normalizedId) || excluded.has(normalizedId)) {
            return null;
        }
        if (!nodeMap.has(normalizedId)) {
            const friend = friends[normalizedId];
            const metadata = metaMap.get(normalizedId) || { lastFetchedAt: null, optedOut: false };
            nodeMap.set(normalizedId, {
                id: normalizedId,
                label: friend?.displayName || friend?.username || normalizedId,
                lastFetchedAt: metadata.lastFetchedAt || null,
                optedOut: Boolean(metadata.optedOut),
                degree: 0
            });
        }
        return nodeMap.get(normalizedId);
    }

    if (snapshot instanceof Map) {
        snapshot.forEach((mutualIds, friendId) => {
            const source = ensureNode(friendId);
            if (!source) {
                return;
            }
            for (const mutualId of Array.isArray(mutualIds) ? mutualIds : []) {
                const target = ensureNode(mutualId);
                if (!target || target.id === source.id) {
                    continue;
                }
                edgeMap.set([source.id, target.id].sort().join('__'), {
                    source: source.id,
                    target: target.id
                });
            }
        });
    }

    for (const edge of edgeMap.values()) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (source) source.degree += 1;
        if (target) target.degree += 1;
    }

    return {
        nodes: Array.from(nodeMap.values()).sort((left, right) => right.degree - left.degree),
        links: Array.from(edgeMap.values())
    };
}

export function filterMutualFriendsGraph(baseGraph, searchQuery) {
    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) {
        return baseGraph;
    }

    const matchedIds = new Set(
        baseGraph.nodes
            .filter(
                (node) =>
                    node.label.toLowerCase().includes(query) ||
                    node.id.toLowerCase().includes(query)
            )
            .map((node) => node.id)
    );
    if (!matchedIds.size) {
        return { nodes: [], links: [] };
    }

    const includedIds = new Set(matchedIds);
    const links = [];
    for (const link of baseGraph.links) {
        if (matchedIds.has(link.source) || matchedIds.has(link.target)) {
            includedIds.add(link.source);
            includedIds.add(link.target);
            links.push(link);
        }
    }

    return {
        nodes: baseGraph.nodes.filter((node) => includedIds.has(node.id)),
        links
    };
}
