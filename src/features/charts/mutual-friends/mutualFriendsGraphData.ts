import type { FriendRecord } from '@/domain/friends/types';

import {
    isValidMutualFriendId,
    normalizeMutualFriendId
} from './mutualFriendsSettings';
import type {
    MutualFriendGraph,
    MutualFriendLink,
    MutualFriendMeta,
    MutualFriendNode,
    MutualFriendSnapshot
} from './mutualFriendsTypes';

export function mutualFriendUsername(friend: FriendRecord | null | undefined) {
    return typeof friend?.username === 'string' ? friend.username : '';
}

export function buildMutualFriendsBaseGraph(
    snapshot: MutualFriendSnapshot | null | undefined,
    meta: MutualFriendMeta | null | undefined,
    friendLabelsById: Readonly<Record<string, string>> | null | undefined,
    excludedFriendIds: readonly string[] = []
): MutualFriendGraph {
    const nodeMap = new Map<string, MutualFriendNode>();
    const totalCountById = new Map<string, number>();
    const edgeMap = new Map<string, MutualFriendLink>();
    const metaMap = meta instanceof Map ? meta : new Map();
    const excluded = new Set(
        excludedFriendIds.map(normalizeMutualFriendId).filter(Boolean)
    );

    function ensureNode(id: string): MutualFriendNode | null {
        const normalizedId = normalizeMutualFriendId(id);
        if (
            !isValidMutualFriendId(normalizedId) ||
            excluded.has(normalizedId)
        ) {
            return null;
        }
        const existing = nodeMap.get(normalizedId);
        if (existing) {
            return existing;
        }
        const metadata = metaMap.get(normalizedId);
        const node: MutualFriendNode = {
            id: normalizedId,
            label: friendLabelsById?.[normalizedId] || normalizedId,
            lastFetchedAt: metadata?.lastFetchedAt ?? null,
            optedOut: Boolean(metadata?.optedOut),
            degree: 0,
            mutualCount: 0
        };
        if (Number.isFinite(metadata?.totalCount)) {
            totalCountById.set(normalizedId, Number(metadata?.totalCount));
        }
        nodeMap.set(normalizedId, node);
        return node;
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
        if (source) {
            source.degree += 1;
        }
        if (target) {
            target.degree += 1;
        }
    }

    for (const node of nodeMap.values()) {
        node.mutualCount = totalCountById.get(node.id) ?? node.degree;
    }

    return {
        nodes: Array.from(nodeMap.values()).sort(
            (left, right) => right.degree - left.degree
        ),
        links: Array.from(edgeMap.values())
    };
}
