import { useEffect, useState } from 'react';

import {
    includeCurrentUserInRoster,
    type CurrentInstanceRosterContext,
    type CurrentInstanceRosterPlayer
} from '@/domain/instances/currentInstanceRoster';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
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
    playerListLocation?: unknown;
    playerListWorldId?: unknown;
    source?: CurrentInstanceRosterContext['source'];
}): CurrentInstanceRosterContext {
    return {
        createdAt: '',
        groupName: '',
        location: normalizeString(playerListLocation),
        playerCount: 0,
        source,
        time: 0,
        worldId: normalizeString(playerListWorldId),
        worldName: ''
    };
}

export function useCurrentInstanceRoster({
    currentUserEndpoint,
    currentUserId,
    currentUserSnapshot,
    disabled,
    isGameRunning,
    logLocationSnapshot,
    playerListLocation,
    playerListStartedAt,
    playerListWorldId,
    refreshRevision,
    tailSyncRevision
}: {
    currentUserEndpoint?: string;
    currentUserId?: unknown;
    currentUserSnapshot?: CurrentUserSnapshot | null;
    disabled: boolean;
    isGameRunning: boolean;
    logLocationSnapshot?: {
        createdAt?: unknown;
        location?: unknown;
        worldName?: unknown;
    } | null;
    playerListLocation?: unknown;
    playerListStartedAt?: unknown;
    playerListWorldId?: unknown;
    refreshRevision?: unknown;
    tailSyncRevision?: unknown;
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

    useEffect(() => {
        let active = true;

        if (disabled) {
            setLoadStatus('idle');
            setDetail('Game log ingestion is disabled.');
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
            currentLocation: playerListLocation,
            currentLocationStartedAt: playerListStartedAt,
            currentUserId
        })
            .then((result) => {
                if (!active) {
                    return;
                }

                const rosterLocation =
                    result.context.location ||
                    normalizeString(playerListLocation);
                const players = parseLocation(rosterLocation).isRealInstance
                    ? includeCurrentUserInRoster({
                          currentUserDisplayName: normalizeString(
                              currentUserSnapshot?.displayName ||
                                  currentUserSnapshot?.username
                          ),
                          currentUserId: normalizeString(currentUserId),
                          joinedAt:
                              result.context.createdAt ||
                              normalizeString(playerListStartedAt),
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
                        nextContext.createdAt ||
                        normalizeString(logLocationSnapshot.createdAt);
                    nextContext.worldName =
                        nextContext.worldName ||
                        normalizeString(logLocationSnapshot.worldName);
                }
                recordGameRuntimePresence({
                    currentLocation:
                        nextContext.location ||
                        normalizeString(playerListLocation),
                    currentLocationPlayers: result.players,
                    currentLocationStartedAt:
                        nextContext.createdAt ||
                        normalizeString(playerListStartedAt),
                    currentUserId,
                    currentUserSnapshot,
                    currentWorldName: nextContext.worldName,
                    endpoint: currentUserEndpoint
                });
                setContext(nextContext);
                setPlayerRows(players);
                setLoadStatus('ready');
                setDetail(
                    result.context.source === 'database'
                        ? 'Rebuilt the current instance roster from local join/leave history.'
                        : 'Using the current runtime location while waiting for local game-log player events.'
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
        currentUserEndpoint,
        currentUserId,
        currentUserSnapshot,
        disabled,
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
