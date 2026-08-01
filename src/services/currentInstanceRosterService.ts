import {
    resolveRuntimeCurrentInstanceRoster,
    type CurrentInstanceRosterContext,
    type CurrentInstanceRosterSnapshot,
    type CurrentInstanceRosterSource,
    type CurrentInstanceRuntimeRoster
} from '@/domain/instances/currentInstanceRoster';
import playerListPersistenceRepository, {
    type PlayerListContext as PersistenceRosterContext
} from '@/repositories/playerListPersistenceRepository';
import { normalizeString } from '@/shared/utils/string';

interface LoadCurrentInstanceRosterInput {
    currentLocation: unknown;
    currentLocationStartedAt?: unknown;
    currentUserId?: unknown;
    runtime?: CurrentInstanceRuntimeRoster;
}

function normalizeSource(value: string): CurrentInstanceRosterSource {
    if (value === 'database' || value === 'runtime') {
        return value;
    }
    return 'none';
}

function normalizeContext(
    context: PersistenceRosterContext
): CurrentInstanceRosterContext {
    return {
        ...context,
        playerCount: context.playerCount ?? 0,
        source: normalizeSource(context.source)
    };
}

export async function loadCurrentInstanceRoster({
    currentLocation,
    currentLocationStartedAt = '',
    currentUserId = '',
    runtime
}: LoadCurrentInstanceRosterInput): Promise<CurrentInstanceRosterSnapshot> {
    const normalizedLocation = normalizeString(currentLocation);
    if (runtime) {
        const runtimeSnapshot = resolveRuntimeCurrentInstanceRoster({
            requestedLocation: normalizedLocation,
            runtime
        });
        if (runtimeSnapshot) {
            return runtimeSnapshot;
        }
    }

    const snapshot =
        await playerListPersistenceRepository.getCurrentInstanceSnapshot({
            currentLocation: normalizedLocation,
            currentLocationStartedAt,
            currentUserId
        });
    return {
        context: normalizeContext(snapshot.context),
        players: snapshot.players
    };
}
