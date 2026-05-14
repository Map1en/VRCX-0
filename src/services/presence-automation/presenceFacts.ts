import { playerListRepository } from '@/repositories/index.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

function normalizeInstanceType(location: Record<string, any>) {
    if (!location?.accessType) {
        return '';
    }
    if (location.accessType !== 'group') {
        return location.accessType;
    }
    if (location.groupAccessType === 'members') {
        return 'groupOnly';
    }
    if (location.groupAccessType === 'plus') {
        return 'groupPlus';
    }
    return 'groupPublic';
}

function getCachedInstanceLocation(instance: Record<string, any>) {
    return String(
        instance?.location ||
            instance?.$location ||
            instance?.instanceLocation ||
            instance?.instanceId ||
            ''
    ).trim();
}

function buildCachedInstanceMap(instances: unknown) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const location = getCachedInstanceLocation(instance);
        if (location) {
            map.set(location, instance?.instance || instance);
        }
    }
    return map;
}

function collectPresentFavoriteGroupKeys(players: Record<string, any>[]) {
    const favoriteState = useFavoriteStore.getState();
    const presentUserIds = new Set(
        (players || []).map((player) => player.userId).filter(Boolean)
    );
    const keys = new Set();

    for (const [groupKey, userIds] of Object.entries(
        favoriteState.groupedFavoriteFriendIdsByGroupKey || {}
    )) {
        if (
            Array.isArray(userIds) &&
            userIds.some((userId) => presentUserIds.has(userId))
        ) {
            keys.add(groupKey);
        }
    }

    for (const [groupName, userIds] of Object.entries(
        favoriteState.localFriendFavorites || {}
    )) {
        if (
            Array.isArray(userIds) &&
            userIds.some((userId) => presentUserIds.has(userId))
        ) {
            keys.add(`local:${groupName}`);
        }
    }

    return Array.from(keys);
}

function resolveCurrentLocation(
    gameState: Record<string, any>,
    currentUser: Record<string, any> | null
) {
    return (
        gameState.currentLocation ||
        gameState.currentDestination ||
        currentUser?.$locationTag ||
        currentUser?.location ||
        ''
    );
}

function getVerifiedCurrentLocation(gameState: Record<string, any>) {
    const currentLocation = String(gameState?.currentLocation || '').trim();
    return currentLocation && currentLocation !== 'traveling'
        ? currentLocation
        : '';
}

function normalizePlayer(player: unknown, index = 0) {
    const source =
        player && typeof player === 'object'
            ? player
            : {
                  id: player,
                  userId: player
              };
    const record = source as Record<string, any>;
    const userId = String(record.userId || record.id || '').trim();
    const displayName = String(
        record.displayName || record.name || userId || ''
    ).trim();
    const id = String(record.id || userId || `runtime:${index}`).trim();
    return {
        ...record,
        id,
        userId,
        displayName
    };
}

function getRuntimePlayers(gameState: Record<string, any>) {
    const players = Array.isArray(gameState?.currentLocationPlayers)
        ? gameState.currentLocationPlayers
              .map((player, index) => normalizePlayer(player, index))
              .filter(
                  (player) => player.id && (player.userId || player.displayName)
              )
        : [];
    if (players.length) {
        return players;
    }

    return Array.isArray(gameState?.currentLocationPlayerIds)
        ? gameState.currentLocationPlayerIds
              .map((userId, index) =>
                  normalizePlayer({ id: userId, userId }, index)
              )
              .filter((player) => player.userId)
        : [];
}

function isLiveCurrentLocation(location: unknown) {
    const normalizedLocation = String(location || '').trim();
    return Boolean(
        normalizedLocation &&
            normalizedLocation !== 'offline' &&
            normalizedLocation !== 'private' &&
            normalizedLocation !== 'traveling'
    );
}

export async function buildPresenceFacts({ now = new Date() } = {}) {
    const runtimeState = useRuntimeStore.getState();
    const auth = runtimeState.auth;
    const gameState = runtimeState.gameState;
    const currentUser = auth.currentUserSnapshot || null;
    const currentUserId = auth.currentUserId || currentUser?.id || '';
    const endpoint = auth.currentUserEndpoint || '';
    const currentLocation = resolveCurrentLocation(gameState, currentUser);
    const parsedLocation = parseLocation(currentLocation);
    const instanceType = normalizeInstanceType(parsedLocation);
    const hasLiveCurrentLocation = isLiveCurrentLocation(currentLocation);

    const snapshot = hasLiveCurrentLocation
        ? await playerListRepository.getCurrentInstanceSnapshot({
              currentUserId,
              currentLocation,
              currentLocationStartedAt: gameState.currentLocationStartedAt || ''
          })
        : {
              context: {
                  location: currentLocation,
                  playerFactsKnown: false,
                  observedPlayerEventCount: 0,
                  source: 'runtime'
              },
              players: []
          };
    const runtimePlayers = hasLiveCurrentLocation
        ? getRuntimePlayers(gameState)
        : [];
    const players = runtimePlayers.length
        ? runtimePlayers
        : Array.isArray(snapshot.players)
          ? snapshot.players
          : [];
    const playerFactsKnown = Boolean(
        snapshot.context?.playerFactsKnown || runtimePlayers.length
    );
    const friendsById = useFriendRosterStore.getState().friendsById || {};
    const presentFriendIds = players
        .map((player) => player.userId)
        .filter((userId) => userId && friendsById[userId]);
    const groupInstances =
        runtimeState.groupInstances.endpoint === endpoint
            ? runtimeState.groupInstances.instances
            : [];
    const currentInviteLocation = getVerifiedCurrentLocation(gameState);
    const canInviteFromCurrentLocation = checkCanInvite(
        currentInviteLocation,
        {
            currentUserId,
            lastLocationStr: getVerifiedCurrentLocation(gameState),
            cachedInstances: buildCachedInstanceMap(groupInstances)
        }
    );

    return {
        now,
        currentUser,
        currentUserId,
        endpoint,
        isGameRunning: Boolean(gameState.isGameRunning),
        isTraveling:
            currentLocation === 'traveling' || Boolean(parsedLocation.isTraveling),
        currentLocation,
        currentDestination: gameState.currentDestination || '',
        currentLocationStartedAt: gameState.currentLocationStartedAt || '',
        parsedLocation,
        instanceType,
        players,
        playerCount: players.length,
        playerFactsKnown,
        observedPlayerEventCount:
            Number(snapshot.context?.observedPlayerEventCount) || 0,
        friendCount: presentFriendIds.length,
        presentFriendIds,
        presentFavoriteGroupKeys: collectPresentFavoriteGroupKeys(players),
        canInviteFromCurrentLocation
    };
}

export { normalizeInstanceType };
