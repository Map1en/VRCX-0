import { commands } from '@/platform/tauri/bindings';
import type {
    PlayerListSnapshotContext,
    PlayerListSnapshotPlayer
} from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

type PlayerListContext = PlayerListSnapshotContext;
type PlayerListPlayer = PlayerListSnapshotPlayer;

interface CurrentInstanceSnapshotInput {
    currentUserId?: unknown;
    currentLocation?: unknown;
    currentLocationStartedAt?: unknown;
}

function comparePlayers(left: PlayerListPlayer, right: PlayerListPlayer) {
    if (left.joinedAtMs !== right.joinedAtMs) {
        return left.joinedAtMs - right.joinedAtMs;
    }

    return String(left.displayName || left.userId || '').localeCompare(
        String(right.displayName || right.userId || ''),
        undefined,
        { sensitivity: 'base' }
    );
}

async function getCurrentInstanceSnapshot({
    currentUserId = '',
    currentLocation = '',
    currentLocationStartedAt = ''
}: CurrentInstanceSnapshotInput = {}): Promise<{
    context: PlayerListContext;
    players: PlayerListPlayer[];
}> {
    const snapshot = await commands.appPlayerListCurrentSnapshot(
        normalizeString(currentUserId),
        normalizeString(currentLocation),
        normalizeString(currentLocationStartedAt)
    );

    return {
        context: snapshot.context,
        players: [...snapshot.players].sort(comparePlayers)
    };
}

const playerListPersistenceRepository = Object.freeze({
    getCurrentInstanceSnapshot
});

export { getCurrentInstanceSnapshot };
export type { PlayerListContext, PlayerListPlayer };
export default playerListPersistenceRepository;
