import { useCallback, useEffect, useMemo, useState } from 'react';

import { getGameLogSessionKey } from './gameLogRows';
import type { GameLogSession } from './gameLogTypes';

export function useGameLogSessionExpansion(
    sessions: readonly GameLogSession[],
    active: boolean
) {
    const [sessionOpenOverrides, setSessionOpenOverrides] = useState(
        () => new Map<string, boolean>()
    );
    const [defaultOpen, setDefaultOpen] = useState(true);
    const allSessionsOpen = useMemo(
        () =>
            sessions.every((session) => {
                const sessionKey = getGameLogSessionKey(session);
                return sessionKey
                    ? (sessionOpenOverrides.get(sessionKey) ?? defaultOpen)
                    : defaultOpen;
            }),
        [defaultOpen, sessionOpenOverrides, sessions]
    );
    const toggleAll = useCallback(() => {
        setSessionOpenOverrides(new Map());
        setDefaultOpen(!allSessionsOpen);
    }, [allSessionsOpen]);
    const onSessionOpenChange = useCallback(
        (sessionKey: string, nextOpen: boolean) => {
            if (!sessionKey) {
                return;
            }
            setSessionOpenOverrides((current) => {
                if (current.get(sessionKey) === nextOpen) {
                    return current;
                }

                const next = new Map(current);
                next.set(sessionKey, nextOpen);
                return next;
            });
        },
        []
    );

    useEffect(() => {
        if (!active) {
            setDefaultOpen(true);
            setSessionOpenOverrides((current) =>
                current.size ? new Map() : current
            );
        }
    }, [active]);

    return {
        allSessionsOpen,
        defaultOpen,
        sessionOpenOverrides,
        onSessionOpenChange,
        toggleAll
    };
}
