import { describe, expect, it } from 'vitest';

import type { FavoriteTransferItemResult } from '@/platform/tauri/bindings';
import type { FavoriteRecord } from '@/state/favoriteStoreTypes';

import type { FavoriteGroup, FavoriteItem } from './favoritesTypes';
import {
    buildFavoriteCopyTargets,
    buildFavoriteMoveTargets,
    buildFavoriteTransferFailureDescription,
    buildFavoriteTransferInput,
    buildFavoriteTransferSuccessfulKeys,
    buildFavoriteTransferTargets,
    filterFavoriteTransferTargetsForOnlineUniqueness,
    groupFavoriteItemsBySourceGroup,
    isFavoriteMoveTargetOverCapacity,
    resolveFavoriteSourceGroup,
    selectedItemsHaveOnlineFavoriteConflict,
    summarizeFavoriteTransferStatuses
} from './favoriteTransfer';

const remoteGroups: FavoriteGroup[] = [
    {
        key: 'world:group_0',
        source: 'remote',
        name: 'group_0',
        type: 'world',
        label: 'Remote A'
    },
    {
        key: 'world:group_1',
        source: 'remote',
        name: 'group_1',
        type: 'world',
        label: 'Remote B'
    }
];
const localGroups: FavoriteGroup[] = [
    { key: 'Local A', source: 'local', label: 'Local A' },
    { key: 'Local B', source: 'local', label: 'Local B' }
];
const remoteItem: FavoriteItem = {
    key: 'remote:world:group_0:wrld_1',
    id: 'wrld_1',
    kind: 'world',
    source: 'remote',
    groupKey: 'world:group_0',
    seedData: {
        id: 'wrld_1',
        name: 'World 1',
        releaseStatus: 'public',
        thumbnailImageUrl: 'https://example.test/world.png'
    }
};
const localItem: FavoriteItem = {
    key: 'local:Local A:wrld_1',
    id: 'wrld_1',
    kind: 'world',
    source: 'local',
    groupKey: 'Local A'
};
const successfulTransferResult: FavoriteTransferItemResult = {
    key: remoteItem.key,
    entityId: remoteItem.id,
    status: 'moved',
    stage: 'addLocal',
    message: '',
    remoteFavorite: null,
    localAffected: 1
};
const failedTransferResult: FavoriteTransferItemResult = {
    key: localItem.key,
    entityId: localItem.id,
    status: 'failed',
    stage: 'addRemote',
    message: 'Favorite limit reached',
    remoteFavorite: null,
    localAffected: 0
};

describe('favorite transfer helpers', () => {
    it('keeps move targets available across remote and local groups except the current group', () => {
        expect(
            buildFavoriteTransferTargets({
                remoteGroups,
                localGroups,
                selectedSource: 'remote',
                selectedGroupKey: 'world:group_0'
            }).map((target) => `${target.source}:${target.key}`)
        ).toEqual(['remote:world:group_1', 'local:Local A', 'local:Local B']);
    });

    it('builds remote to local payload with the entity id used as the remote delete object id', () => {
        const input = buildFavoriteTransferInput({
            endpoint: 'https://api.vrchat.cloud/api/1',
            kind: 'world',
            sourceGroup: remoteGroups[0],
            targetGroup: localGroups[0],
            selectedItems: [remoteItem]
        });

        expect(input).toMatchObject({
            kind: 'world',
            source: {
                location: 'remote',
                group: 'group_0'
            },
            target: {
                location: 'local',
                group: 'Local A'
            },
            items: [
                {
                    key: 'remote:world:group_0:wrld_1',
                    entityId: 'wrld_1'
                }
            ]
        });
        expect(input.items?.[0]?.entity).toEqual(remoteItem.seedData);
        expect(input.items?.[0]).not.toHaveProperty('remoteFavoriteRecordId');
    });

    it('builds local to remote payload as copy-only', () => {
        const input = buildFavoriteTransferInput({
            endpoint: '',
            kind: 'world',
            sourceGroup: localGroups[0],
            targetGroup: remoteGroups[1],
            selectedItems: [localItem]
        });

        expect(input).toMatchObject({
            source: {
                location: 'local',
                group: 'Local A'
            },
            target: {
                location: 'remote',
                group: 'group_1',
                favoriteType: 'world'
            },
            items: [
                {
                    entityId: 'wrld_1'
                }
            ]
        });
        expect(input.items?.[0]).not.toHaveProperty('remoteFavoriteRecordId');
    });

    it('returns only successful transfer keys for selection cleanup', () => {
        expect(
            Array.from(
                buildFavoriteTransferSuccessfulKeys([
                    successfulTransferResult,
                    failedTransferResult
                ])
            )
        ).toEqual([remoteItem.key]);
    });

    it('builds per-item failure details with the failing stage and message', () => {
        expect(
            buildFavoriteTransferFailureDescription({
                results: [successfulTransferResult, failedTransferResult],
                selectedItems: [remoteItem, localItem],
                fallbackMessage: 'Failed to move selected favorites'
            })
        ).toBe('wrld_1 [addRemote]: Favorite limit reached');
    });

    it('flags a move target as over capacity once selected items would exceed it', () => {
        const target: FavoriteGroup = {
            key: 'world:group_0',
            source: 'remote',
            label: 'Remote A',
            count: 98,
            capacity: 100
        };
        expect(isFavoriteMoveTargetOverCapacity(target, 2)).toBe(false);
        expect(isFavoriteMoveTargetOverCapacity(target, 3)).toBe(true);
    });

    it('treats move targets without a capacity as never over capacity', () => {
        expect(
            isFavoriteMoveTargetOverCapacity(
                {
                    key: 'Local A',
                    source: 'local',
                    label: 'Local A',
                    count: 500
                },
                999
            )
        ).toBe(false);
    });

    it('treats a zero capacity as unlimited instead of always full', () => {
        expect(
            isFavoriteMoveTargetOverCapacity(
                {
                    key: 'Local A',
                    source: 'local',
                    label: 'Local A',
                    count: 500,
                    capacity: 0
                },
                999
            )
        ).toBe(false);
    });

    it('groups selected items by their originating source and group for safe cross-group moves', () => {
        const groupAItem: FavoriteItem = {
            ...remoteItem,
            key: 'remote:world:group_0:wrld_a',
            id: 'wrld_a'
        };
        const groupBItem: FavoriteItem = {
            ...remoteItem,
            key: 'remote:world:group_1:wrld_b',
            id: 'wrld_b',
            groupKey: 'world:group_1'
        };
        const batches = groupFavoriteItemsBySourceGroup([
            groupAItem,
            groupBItem,
            localItem
        ]);
        expect(batches).toHaveLength(3);
        expect(batches.map((batch) => batch.map((item) => item.key))).toEqual([
            [groupAItem.key],
            [groupBItem.key],
            [localItem.key]
        ]);
    });

    it('keeps items from the same source group together in one batch', () => {
        const secondGroupAItem: FavoriteItem = {
            ...remoteItem,
            key: 'remote:world:group_0:wrld_c',
            id: 'wrld_c'
        };
        const batches = groupFavoriteItemsBySourceGroup([
            remoteItem,
            secondGroupAItem
        ]);
        expect(batches).toEqual([[remoteItem, secondGroupAItem]]);
    });

    it('resolves the actual favorite group object matching an item source and group key', () => {
        expect(
            resolveFavoriteSourceGroup({
                item: localItem,
                remoteGroups,
                localGroups
            })
        ).toEqual(localGroups[0]);
    });

    it('falls back to a synthetic group when no matching group object is found', () => {
        const orphanedItem: FavoriteItem = {
            ...localItem,
            groupKey: 'Missing Group',
            groupLabel: 'Missing Group Label'
        };
        expect(
            resolveFavoriteSourceGroup({
                item: orphanedItem,
                remoteGroups,
                localGroups
            })
        ).toEqual({
            key: 'Missing Group',
            source: 'local',
            label: 'Missing Group Label'
        });
    });

    it('reports no online conflict when the entity is not favorited remotely', () => {
        expect(
            selectedItemsHaveOnlineFavoriteConflict({
                selectedItems: [localItem],
                selectedSource: 'local',
                selectedGroupKey: 'Local A',
                remoteFavoritesByObjectId: {}
            })
        ).toBe(false);
    });

    it('reports an online conflict when a selected entity is already favorited in a different remote group', () => {
        const remoteFavoritesByObjectId: Record<string, FavoriteRecord> = {
            wrld_1: { favoriteId: 'wrld_1', $groupKey: 'world:group_1' }
        };
        expect(
            selectedItemsHaveOnlineFavoriteConflict({
                selectedItems: [localItem],
                selectedSource: 'local',
                selectedGroupKey: 'Local A',
                remoteFavoritesByObjectId
            })
        ).toBe(true);
    });

    it('does not flag an online conflict for the group an item is currently sitting in', () => {
        const remoteFavoritesByObjectId: Record<string, FavoriteRecord> = {
            wrld_1: { favoriteId: 'wrld_1', $groupKey: 'world:group_0' }
        };
        expect(
            selectedItemsHaveOnlineFavoriteConflict({
                selectedItems: [remoteItem],
                selectedSource: 'remote',
                selectedGroupKey: 'world:group_0',
                remoteFavoritesByObjectId
            })
        ).toBe(false);
    });

    it('drops remote targets once an online conflict is present', () => {
        expect(
            filterFavoriteTransferTargetsForOnlineUniqueness({
                targets: [...remoteGroups, ...localGroups],
                hasOnlineConflict: true
            }).every((target) => target.source !== 'remote')
        ).toBe(true);
    });

    it('keeps every target when there is no online conflict', () => {
        expect(
            filterFavoriteTransferTargetsForOnlineUniqueness({
                targets: [...remoteGroups, ...localGroups],
                hasOnlineConflict: false
            })
        ).toHaveLength(remoteGroups.length + localGroups.length);
    });

    it('hides remote copy targets when the selection itself comes from a remote group', () => {
        const targets = buildFavoriteCopyTargets({
            remoteGroups,
            localGroups,
            selectedSource: 'remote',
            selectedGroupKey: 'world:group_0',
            selectedItems: [remoteItem],
            remoteFavoritesByObjectId: {}
        });
        expect(targets.every((target) => target.source !== 'remote')).toBe(
            true
        );
        expect(targets).toHaveLength(localGroups.length);
    });

    it('hides remote copy targets when a local selection is already favorited online elsewhere', () => {
        const remoteFavoritesByObjectId: Record<string, FavoriteRecord> = {
            wrld_1: { favoriteId: 'wrld_1', $groupKey: 'world:group_1' }
        };
        const targets = buildFavoriteCopyTargets({
            remoteGroups,
            localGroups,
            selectedSource: 'local',
            selectedGroupKey: 'Local A',
            selectedItems: [localItem],
            remoteFavoritesByObjectId
        });
        expect(targets.every((target) => target.source !== 'remote')).toBe(
            true
        );
    });

    it('allows remote copy targets for a plain local selection with no online conflict', () => {
        const targets = buildFavoriteCopyTargets({
            remoteGroups,
            localGroups,
            selectedSource: 'local',
            selectedGroupKey: 'Local A',
            selectedItems: [localItem],
            remoteFavoritesByObjectId: {}
        });
        expect(targets.some((target) => target.source === 'remote')).toBe(true);
    });

    it('still allows remote move targets between two remote groups (no online conflict)', () => {
        const targets = buildFavoriteMoveTargets({
            remoteGroups,
            localGroups,
            selectedSource: 'remote',
            selectedGroupKey: 'world:group_0',
            selectedItems: [remoteItem],
            remoteFavoritesByObjectId: {
                wrld_1: { favoriteId: 'wrld_1', $groupKey: 'world:group_0' }
            }
        });
        expect(targets.some((target) => target.source === 'remote')).toBe(true);
    });

    it('blocks remote move targets when a local selection is already favorited online elsewhere', () => {
        const remoteFavoritesByObjectId: Record<string, FavoriteRecord> = {
            wrld_1: { favoriteId: 'wrld_1', $groupKey: 'world:group_1' }
        };
        const targets = buildFavoriteMoveTargets({
            remoteGroups,
            localGroups,
            selectedSource: 'local',
            selectedGroupKey: 'Local A',
            selectedItems: [localItem],
            remoteFavoritesByObjectId
        });
        expect(targets.every((target) => target.source !== 'remote')).toBe(
            true
        );
    });

    it('summarizes transfer results into per-status counts', () => {
        const results: FavoriteTransferItemResult[] = [
            successfulTransferResult,
            failedTransferResult,
            { ...successfulTransferResult, status: 'copied', key: 'k2' },
            {
                ...successfulTransferResult,
                status: 'skippedAlreadyPresent',
                key: 'k3'
            },
            {
                ...successfulTransferResult,
                status: 'restoredToSource',
                key: 'k4'
            },
            {
                ...successfulTransferResult,
                status: 'savedToLocalFallback',
                key: 'k5'
            },
            {
                ...successfulTransferResult,
                status: 'targetAddedSourceDeleteFailed',
                key: 'k6'
            }
        ];
        expect(summarizeFavoriteTransferStatuses(results)).toEqual({
            succeeded: 2,
            skippedAlreadyPresent: 1,
            restoredToSource: 1,
            savedToLocalFallback: 1,
            targetAddedSourceDeleteFailed: 1,
            failed: 1
        });
    });
});
