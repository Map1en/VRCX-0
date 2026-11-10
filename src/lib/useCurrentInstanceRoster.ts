import { useEffect, useState } from 'react';

import {
    decorateCurrentUserInRoster,
    type CurrentInstanceRosterContext,
    type CurrentInstanceRosterPlayer
} from '@/domain/instances/currentInstanceRoster';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { LogLocationSnapshot } from '@/platform/tauri/bindings';
import { loadCurrentInstanceRoster } from '@/services/currentInstanceRosterService';
import { recordGameRuntimePresence } from '@/services/domainIngestionService';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';

type CurrentUserSnapshot = Record<string, unknown>;
type CurrentInstanceRosterLoadStatus = 'error' | 'idle' | 'ready' | 'running';

function createRuntimeContext({
    playerListLocation,
    playerListWorldId,
    source = 'runtime'
}: {
    playerListLocation?: string;
    playerListWorldId?: string;
    source?: CurrentInstanceRosterContext['source'];
}): CurrentInstanceRosterContext {
    return {
        createdAt: '',
        groupName: '',
        location: playerListLocation ?? '',
        playerCount: 0,
        source,
        time: 0,
        worldId: playerListWorldId ?? '',
        worldName: ''
    };
}

export function useCurrentInstanceRoster({
    currentUserEndpoint,
    currentUserId,
    currentUserSnapshot,
    isGameRunning,
    logLocationSnapshot,
    playerListLocation,
    playerListStartedAt,
    playerListWorldId,
    refreshRevision,
    tailSyncRevision
}: {
    currentUserEndpoint?: string;
    currentUserId?: string | null;
    currentUserSnapshot?: CurrentUserSnapshot | null;
    isGameRunning: boolean;
    logLocationSnapshot?: LogLocationSnapshot | null;
    playerListLocation?: string;
    playerListStartedAt?: string | null;
    playerListWorldId?: string;
    refreshRevision?: number;
    tailSyncRevision?: string | null;
}) {
    const [loadStatus, setLoadStatus] =
        useState<CurrentInstanceRosterLoadStatus>('idle');
    const [detail, setDetail] = useState('');
    const [context, setContext] = useState<CurrentInstanceRosterContext>(() =>
        createRuntimeContext({ source: 'none' })
    );
    const [playerRows, setPlayerRows] = useState<CurrentInstanceRosterPlayer[]>(
        []
    );
    const currentUserDisplayName = normalizeString(
        currentUserSnapshot?.displayName || currentUserSnapshot?.username
    );

    useEffect(() => {
        let active = true;

        if (!isGameRunning) {
            setLoadStatus('idle');
            setDetail('');
            setContext(
                createRuntimeContext({
                    playerListLocation,
                    playerListWorldId
                })
            );
            setPlayerRows([]);
            return () => {
                active = false;
            };
        }

        if (!playerListLocation) {
            setLoadStatus('idle');
            setDetail('Waiting for the current runtime location.');
            setContext(
                createRuntimeContext({
                    playerListLocation: '',
                    playerListWorldId
                })
            );
            setPlayerRows([]);
            return () => {
                active = false;
            };
        }

        if (playerListLocation === 'traveling') {
            setLoadStatus('idle');
            setDetail('');
            setContext(
                createRuntimeContext({
                    playerListLocation: 'traveling',
                    playerListWorldId: ''
                })
            );
            setPlayerRows([]);
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');

        loadCurrentInstanceRoster({
            currentLocation: playerListLocation
        })
            .then((result) => {
                if (!active) {
                    return;
                }

                const rosterLocation =
                    result.context.location || playerListLocation;
                const players =
                    result.context.playerFactsKnown &&
                    parseLocation(rosterLocation).isRealInstance
                        ? decorateCurrentUserInRoster({
                              currentUserDisplayName,
                              currentUserId: currentUserId ?? '',
                              joinedAt:
                                  result.context.createdAt ||
                                  (playerListStartedAt ?? ''),
                              players: result.players
                          })
                        : result.players;
                const nextContext: CurrentInstanceRosterContext = {
                    ...result.context,
                    playerCount: players.length || result.context.playerCount
                };
                if (
                    logLocationSnapshot?.location &&
                    logLocationSnapshot.location === nextContext.location
                ) {
                    nextContext.createdAt =
                        nextContext.createdAt || logLocationSnapshot.createdAt;
                    nextContext.worldName =
                        nextContext.worldName || logLocationSnapshot.worldName;
                }
                recordGameRuntimePresence({
                    currentLocation: nextContext.location || playerListLocation,
                    currentLocationPlayers: result.players,
                    currentLocationStartedAt:
                        nextContext.createdAt || playerListStartedAt || '',
                    currentWorldName: nextContext.worldName,
                    endpoint: currentUserEndpoint
                });
                setContext(nextContext);
                setPlayerRows(players);
                setLoadStatus('ready');
                setDetail(
                    result.context.playerFactsKnown
                        ? 'Current instance roster is ready.'
                        : 'Waiting for current game-log player events.'
                );
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                setLoadStatus('error');
                setPlayerRows([]);
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to reconstruct current players for the current instance.'
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [
        currentUserDisplayName,
        currentUserEndpoint,
        currentUserId,
        isGameRunning,
        logLocationSnapshot?.createdAt,
        logLocationSnapshot?.location,
        logLocationSnapshot?.worldName,
        playerListLocation,
        playerListStartedAt,
        playerListWorldId,
        refreshRevision,
        tailSyncRevision
    ]);

    return {
        context,
        detail,
        loadStatus,
        playerRows
    };
}
