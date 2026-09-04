import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

import {
    communityColor,
    MUTUAL_GRAPH_NAMED_COMMUNITY_LIMIT
} from './mutualFriendsPalette';
import type {
    MutualFriendCommunity,
    MutualFriendCommunityAssignment,
    MutualFriendGraph
} from './mutualFriendsTypes';

const LOUVAIN_SEED = 0x9e3779b9;
const MIN_NAMED_COMMUNITY_SIZE = 2;

function createSeededRandom(seed: number) {
    let state = seed >>> 0;
    return function seededRandom() {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function assignMutualFriendCommunities(
    graph: MutualFriendGraph,
    palette: string[],
    neutralColor: string
): MutualFriendCommunityAssignment {
    const communityIndexById = new Map<string, number>();
    if (!graph.nodes.length) {
        return { communityIndexById, communities: [] };
    }

    const graphologyGraph = new Graph({
        type: 'undirected',
        multi: false,
        allowSelfLoops: false
    });
    for (const node of graph.nodes) {
        graphologyGraph.addNode(node.id);
    }
    for (const link of graph.links) {
        if (
            !graphologyGraph.hasNode(link.source) ||
            !graphologyGraph.hasNode(link.target) ||
            graphologyGraph.hasEdge(link.source, link.target)
        ) {
            continue;
        }
        graphologyGraph.addEdge(link.source, link.target);
    }

    const rawCommunities: Record<string, number | string> =
        graphologyGraph.size > 0
            ? louvain(graphologyGraph, {
                  rng: createSeededRandom(LOUVAIN_SEED)
              })
            : {};

    const members = new Map<string, string[]>();
    for (const node of graph.nodes) {
        const rawId = String(rawCommunities[node.id] ?? 'isolated');
        const bucket = members.get(rawId);
        if (bucket) {
            bucket.push(node.id);
        } else {
            members.set(rawId, [node.id]);
        }
    }

    const degreeById = new Map(
        graph.nodes.map((node) => [node.id, node.degree])
    );
    const labelById = new Map(graph.nodes.map((node) => [node.id, node.label]));

    const ranked = Array.from(members.entries()).sort((left, right) => {
        if (right[1].length !== left[1].length) {
            return right[1].length - left[1].length;
        }
        return left[0].localeCompare(right[0]);
    });

    const namedLimit = Math.min(
        MUTUAL_GRAPH_NAMED_COMMUNITY_LIMIT,
        palette.length
    );

    const communities: MutualFriendCommunity[] = ranked.map(
        ([, memberIds], index) => {
            for (const memberId of memberIds) {
                communityIndexById.set(memberId, index);
            }
            const anchorId = memberIds.reduce((best, candidate) =>
                (degreeById.get(candidate) ?? 0) > (degreeById.get(best) ?? 0)
                    ? candidate
                    : best
            );
            const isNamed =
                index < namedLimit &&
                memberIds.length >= MIN_NAMED_COMMUNITY_SIZE;
            return {
                index,
                size: memberIds.length,
                color: communityColor(palette, index, isNamed, neutralColor),
                label: labelById.get(anchorId) ?? anchorId,
                isNamed
            };
        }
    );

    return { communityIndexById, communities };
}
