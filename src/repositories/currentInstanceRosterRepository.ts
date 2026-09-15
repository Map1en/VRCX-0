import { commands } from '@/platform/tauri/bindings';
import type {
    PlayerListSnapshotContext,
    PlayerListSnapshotOutput,
    PlayerListSnapshotPlayer
} from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

type PlayerListContext = PlayerListSnapshotContext;
type PlayerListPlayer = PlayerListSnapshotPlayer;

interface CurrentInstanceSnapshotInput {
    currentLocation?: string;
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
    currentLocation = ''
}: CurrentInstanceSnapshotInput = {}): Promise<PlayerListSnapshotOutput> {
    const snapshot = await commands.appPlayerListCurrentSnapshot(
        normalizeString(currentLocation)
    );

    return {
        context: snapshot.context,
        players: [...snapshot.players].sort(comparePlayers)
    };
}

const currentInstanceRosterRepository = Object.freeze({
    getCurrentInstanceSnapshot
});

export { getCurrentInstanceSnapshot };
export type { PlayerListContext };
export default currentInstanceRosterRepository;
