import { describe, expect, it } from 'vitest';

import {
    buildFavoriteBulkRemoveInput,
    favoriteBulkRemoveSuccessfulKeys
} from './favoriteBulkRemove';

describe('favoriteBulkRemove', () => {
    it('builds one mixed local and remote batch', () => {
        expect(
            buildFavoriteBulkRemoveInput({
                expectedEndpoint: 'https://api.example.test',
                expectedOwnerUserId: 'usr_self',
                kind: 'world',
                items: [
                    {
                        key: 'local:Worlds:wrld_local',
                        id: 'wrld_local',
                        kind: 'world',
                        source: 'local',
                        groupKey: 'Worlds'
                    },
                    {
                        key: 'remote:world:group_0:wrld_remote',
                        id: 'wrld_remote',
                        kind: 'world',
                        source: 'remote',
                        groupKey: 'world:group_0'
                    }
                ]
            })
        ).toEqual({
            expectedEndpoint: 'https://api.example.test',
            expectedOwnerUserId: 'usr_self',
            kind: 'world',
            items: [
                {
                    key: 'local:Worlds:wrld_local',
                    source: 'local',
                    entityId: 'wrld_local',
                    groupName: 'Worlds'
                },
                {
                    key: 'remote:world:group_0:wrld_remote',
                    source: 'remote',
                    entityId: 'wrld_remote',
                    groupName: 'world:group_0'
                }
            ]
        });
    });

    it('returns only terminally removed selection keys', () => {
        expect(
            Array.from(
                favoriteBulkRemoveSuccessfulKeys({
                    ownerUserId: 'usr_self',
                    kind: 'avatar',
                    total: 3,
                    succeeded: 1,
                    failed: 2,
                    localChanged: true,
                    remoteChanged: false,
                    items: [
                        {
                            key: 'removed',
                            source: 'local',
                            entityId: 'avtr_removed',
                            state: 'removed',
                            localAffected: 1,
                            message: ''
                        },
                        {
                            key: 'failed',
                            source: 'remote',
                            entityId: 'avtr_failed',
                            state: 'failed',
                            localAffected: 0,
                            message: 'denied'
                        },
                        {
                            key: 'pending',
                            source: 'remote',
                            entityId: 'avtr_pending',
                            state: 'notAttempted',
                            localAffected: 0,
                            message: 'scope changed'
                        }
                    ],
                    lastError: 'scope changed'
                })
            )
        ).toEqual(['removed']);
    });

    it('rejects history entries instead of treating them as remote favorites', () => {
        expect(() =>
            buildFavoriteBulkRemoveInput({
                expectedEndpoint: 'https://api.example.test',
                expectedOwnerUserId: 'usr_self',
                kind: 'world',
                items: [
                    {
                        key: 'history:wrld_recent',
                        id: 'wrld_recent',
                        kind: 'world',
                        source: 'history'
                    }
                ]
            })
        ).toThrow('Favorite history entries cannot be removed as favorites.');
    });
});
