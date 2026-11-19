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
import { structuralEqual } from '@/shared/utils/structuralEqual';

type CurrentUserSnapshot = Record<string, unknown>;
type CurrentInstanceRosterLoadStatus = 'error' | 'idle' | 'ready' | 'running';
type CurrentInstanceRosterStatus = {
    loadStatus: CurrentInstanceRosterLoadStatus;
    detail: string;
    location: string;
};

const EMPTY_PLAYER_ROWS: CurrentInstanceRosterPlayer[] = [];

function keepIfEqual<T>(next: NoInfer<T>) {
    return (current: T): T => (structuralEqual(current, next) ? current : next);
}

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
    const [{ loadStatus, detail }, setStatus] =
        useState<CurrentInstanceRosterStatus>({
            loadStatus: 'idle',
            detail: '',
            location: ''
        });
    const [context, setContext] = useState<CurrentInstanceRosterContext>(() =>
        createRuntimeContext({ source: 'none' })
    );
    const [playerRows, setPlayerRows] =
        useState<CurrentInstanceRosterPlayer[]>(EMPTY_PLAYER_ROWS);
    const currentUserDisplayName = normalizeString(
        currentUserSnapshot?.displayName || currentUserSnapshot?.username
    );

    useEffect(() => {
        let active = true;

        if (!isGameRunning) {
            setStatus(
                keepIfEqual({ loadStatus: 'idle', detail: '', location: '' })
            );
            setContext(
                keepIfEqual(
                    createRuntimeContext({
                        playerListLocation,
                        playerListWorldId
                    })
                )
            );
            setPlayerRows(EMPTY_PLAYER_ROWS);
            return () => {
                active = false;
            };
        }

        if (!playerListLocation) {
            setStatus(
                keepIfEqual({
                    loadStatus: 'idle',
                    detail: 'Waiting for the current runtime location.',
                    location: ''
                })
            );
            setContext(
                keepIfEqual(
                    createRuntimeContext({
                        playerListLocation: '',
                        playerListWorldId
                    })
                )
            );
            setPlayerRows(EMPTY_PLAYER_ROWS);
            return () => {
                active = false;
            };
        }

        if (playerListLocation === 'traveling') {
            setStatus(
                keepIfEqual({ loadStatus: 'idle', detail: '', location: '' })
            );
            setContext(
                keepIfEqual(
                    createRuntimeContext({
                        playerListLocation: 'traveling',
                        playerListWorldId: ''
                    })
                )
            );
            setPlayerRows(EMPTY_PLAYER_ROWS);
            return () => {
                active = false;
            };
        }

        setStatus((current) =>
            current.loadStatus === 'ready' &&
            current.location === playerListLocation
                ? current
                : { loadStatus: 'running', detail: '', location: '' }
        );

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
                setContext(keepIfEqual(nextContext));
                setPlayerRows(keepIfEqual(players));
                setStatus(
                    keepIfEqual({
                        loadStatus: 'ready',
                        detail: result.context.playerFactsKnown
                            ? 'Current instance roster is ready.'
                            : 'Waiting for current game-log player events.',
                        location: playerListLocation
                    })
                );
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                setPlayerRows(EMPTY_PLAYER_ROWS);
                setStatus(
                    keepIfEqual({
                        loadStatus: 'error',
                        detail: userFacingErrorMessage(
                            error,
                            'Failed to reconstruct current players for the current instance.'
                        ),
                        location: ''
                    })
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
