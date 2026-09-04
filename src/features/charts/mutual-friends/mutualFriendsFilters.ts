import type {
    MutualFriendGraph,
    MutualFriendLink,
    MutualFriendNode,
    MutualFriendsIsolatedCounts,
    MutualFriendsViewFilters
} from './mutualFriendsTypes';

export const MUTUAL_GRAPH_MIN_DEGREE_LIMITS = { min: 0, max: 20 };

export const MUTUAL_GRAPH_DEFAULT_VIEW_FILTERS: MutualFriendsViewFilters = {
    searchQuery: '',
    minDegree: 0,
    focusedCommunity: null
};

function keepLinksBetween(
    links: MutualFriendLink[],
    keptIds: Set<string>
): MutualFriendLink[] {
    return links.filter(
        (link) => keptIds.has(link.source) && keptIds.has(link.target)
    );
}

function matchesSearch(node: MutualFriendNode, query: string) {
    return (
        node.label.toLowerCase().includes(query) ||
        node.id.toLowerCase().includes(query)
    );
}

export function applyMutualFriendsViewFilters(
    baseGraph: MutualFriendGraph,
    filters: MutualFriendsViewFilters,
    communityIndexById: Map<string, number>
): MutualFriendGraph {
    let nodes = baseGraph.nodes;

    if (filters.focusedCommunity !== null) {
        nodes = nodes.filter(
            (node) =>
                communityIndexById.get(node.id) === filters.focusedCommunity
        );
    }

    if (filters.minDegree > 0) {
        nodes = nodes.filter((node) => node.degree >= filters.minDegree);
    }

    let keptIds = new Set(nodes.map((node) => node.id));
    let links = keepLinksBetween(baseGraph.links, keptIds);

    const query = filters.searchQuery.trim().toLowerCase();
    if (!query) {
        return { nodes, links };
    }

    const matchedIds = new Set(
        nodes
            .filter((node) => matchesSearch(node, query))
            .map((node) => node.id)
    );
    if (!matchedIds.size) {
        return { nodes: [], links: [] };
    }

    const neighborhoodIds = new Set(matchedIds);
    for (const link of links) {
        if (matchedIds.has(link.source) || matchedIds.has(link.target)) {
            neighborhoodIds.add(link.source);
            neighborhoodIds.add(link.target);
        }
    }

    keptIds = neighborhoodIds;
    nodes = nodes.filter((node) => keptIds.has(node.id));
    links = keepLinksBetween(links, keptIds);

    return { nodes, links };
}

export function isMutualFriendNodeUnavailable(node: MutualFriendNode) {
    return node.optedOut || node.lastFetchedAt === null;
}

export function countIsolatedMutualFriendNodes(
    graph: MutualFriendGraph
): MutualFriendsIsolatedCounts {
    let noConnections = 0;
    let unavailable = 0;
    for (const node of graph.nodes) {
        if (node.degree !== 0) {
            continue;
        }
        if (isMutualFriendNodeUnavailable(node)) {
            unavailable += 1;
        } else {
            noConnections += 1;
        }
    }
    return { noConnections, unavailable };
}
