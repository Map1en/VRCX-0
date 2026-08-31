import { describe, expect, it } from 'vitest';

import { buildMutualFriendsBaseGraph } from './mutualFriendsGraphData';
import { MUTUAL_GRAPH_EMPTY_USER_ID } from './mutualFriendsSettings';

describe('mutualFriendsGraphData', () => {
    it('turns a cached mutual-friends snapshot into unique graph nodes and edges', () => {
        const graph = buildMutualFriendsBaseGraph(
            new Map([
                [
                    'usr_a',
                    ['usr_b', 'usr_c', 'usr_b', MUTUAL_GRAPH_EMPTY_USER_ID]
                ],
                ['usr_b', ['usr_a']],
                ['usr_c', ['usr_a']]
            ]),
            new Map([
                [
                    'usr_c',
                    {
                        lastFetchedAt: '2026-04-01T00:00:00.000Z',
                        optedOut: true,
                        totalCount: 4
                    }
                ]
            ]),
            {
                usr_a: 'Ava',
                usr_b: 'ben_user',
                usr_c: 'Cora'
            }
        );

        expect(
            graph.links.map((link) => [link.source, link.target].sort())
        ).toEqual([
            ['usr_a', 'usr_b'],
            ['usr_a', 'usr_c']
        ]);
        expect(
            graph.nodes.map((node) => [node.id, node.label, node.degree])
        ).toEqual([
            ['usr_a', 'Ava', 2],
            ['usr_b', 'ben_user', 1],
            ['usr_c', 'Cora', 1]
        ]);
        expect(graph.nodes.find((node) => node.id === 'usr_c')).toMatchObject({
            lastFetchedAt: '2026-04-01T00:00:00.000Z',
            optedOut: true,
            mutualCount: 4
        });
        expect(graph.nodes.find((node) => node.id === 'usr_a')).toMatchObject({
            mutualCount: 2
        });
    });

    it('removes hidden friends before users see graph nodes or connecting edges', () => {
        const graph = buildMutualFriendsBaseGraph(
            new Map([
                ['usr_a', ['usr_b', 'usr_c']],
                ['usr_c', ['usr_a']]
            ]),
            new Map(),
            {},
            ['usr_c']
        );

        expect(graph.nodes.map((node) => node.id)).toEqual(['usr_a', 'usr_b']);
        expect(graph.links).toEqual([{ source: 'usr_a', target: 'usr_b' }]);
    });

    it('still renders cached relationships when optional metadata is missing', () => {
        const graph = buildMutualFriendsBaseGraph(
            new Map([['usr_a', ['usr_b']]]),
            null,
            null
        );

        expect(
            graph.nodes.map((node) => [node.id, node.label, node.degree])
        ).toEqual([
            ['usr_a', 'usr_a', 1],
            ['usr_b', 'usr_b', 1]
        ]);
        expect(graph.links).toEqual([{ source: 'usr_a', target: 'usr_b' }]);
    });
});
