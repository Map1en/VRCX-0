import type { WorldProfileRecord } from '@/domain/entities/world';
import type { FriendRecord } from '@/domain/friends/types';
import { commands } from '@/platform/tauri/bindings';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { isRecord } from '@/shared/utils/record';

export type SearchHotMode = 'active' | 'discover';

export type SearchHotWorld = {
    world: WorldProfileRecord;
    userCount: number;
    instanceCount: number;
};

function finiteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function instanceUserCount(instance: Record<string, unknown>) {
    return (
        finiteNumber(instance.userCount) ?? finiteNumber(instance.n_users) ?? 0
    );
}

export function aggregateHotWorlds(instances: unknown[]): SearchHotWorld[] {
    const worlds = new Map<string, SearchHotWorld>();
    for (const instance of instances) {
        if (!isRecord(instance) || !isRecord(instance.world)) {
            continue;
        }
        const worldId =
            typeof instance.world.id === 'string' ? instance.world.id : '';
        if (!worldId) {
            continue;
        }
        let entry = worlds.get(worldId);
        if (!entry) {
            entry = {
                world: worldProfileRepository.normalize(instance.world),
                userCount: 0,
                instanceCount: 0
            };
            worlds.set(worldId, entry);
        }
        entry.userCount += instanceUserCount(instance);
        entry.instanceCount += 1;
    }
    return [...worlds.values()].sort(
        (left, right) => right.userCount - left.userCount
    );
}

export function loadHotInstances(mode: SearchHotMode): Promise<unknown[]> {
    return mode === 'active'
        ? commands.appVrchatInstancesActiveGet()
        : commands.appVrchatInstancesDiscoverGet();
}

export function hotWorldIdOfFriend(
    friend: Pick<FriendRecord, '$presence'>
): string {
    if (friend.$presence.kind !== 'online') {
        return '';
    }
    const { location } = friend.$presence.place;
    return location.isRealInstance &&
        !location.isPrivate &&
        !location.isTraveling
        ? location.worldId
        : '';
}

export function groupFriendsByWorld<T extends Pick<FriendRecord, '$presence'>>(
    friends: readonly T[]
): Map<string, T[]> {
    const byWorld = new Map<string, T[]>();
    for (const friend of friends) {
        const worldId = hotWorldIdOfFriend(friend);
        if (!worldId) {
            continue;
        }
        const group = byWorld.get(worldId);
        if (group) {
            group.push(friend);
        } else {
            byWorld.set(worldId, [friend]);
        }
    }
    return byWorld;
}

export async function loadRecentFriendCounts(
    worlds: readonly SearchHotWorld[]
): Promise<Record<string, number>> {
    const rows = await commands.appWorldRecentFriendCounts(
        worlds.map((entry) => entry.world.id)
    );
    return Object.fromEntries(
        rows.map((row) => [row.worldId, row.friendCount])
    );
}
