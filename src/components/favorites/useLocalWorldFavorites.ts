import { useCallback, useEffect, useRef, useState } from 'react';

import type { LoadStatus } from '@/domain/shared/types';
import {
    loadLocalWorldFavoritesSnapshot,
    type LocalWorldFavoritesSnapshot
} from '@/services/localWorldFavoritesService';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

type LocalWorldFavoritesStatus = LoadStatus;

const EMPTY_SNAPSHOT: LocalWorldFavoritesSnapshot = {
    favoritesByGroup: {},
    groups: []
};

export function useLocalWorldFavorites(enabled: boolean = true) {
    const localWorldRevision = useFavoriteRevisionStore(
        (state) => state.localWorldRevision
    );
    const sequenceRef = useRef(0);
    const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
    const [status, setStatus] = useState<LocalWorldFavoritesStatus>('idle');

    const reload = useCallback(async (): Promise<boolean> => {
        const sequence = ++sequenceRef.current;
        setStatus('running');
        try {
            const nextSnapshot = await loadLocalWorldFavoritesSnapshot();
            if (sequence === sequenceRef.current) {
                setSnapshot(nextSnapshot);
                setStatus('ready');
            }
            return true;
        } catch {
            if (sequence === sequenceRef.current) {
                setSnapshot(EMPTY_SNAPSHOT);
                setStatus('error');
            }
            return false;
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            sequenceRef.current += 1;
            setSnapshot(EMPTY_SNAPSHOT);
            setStatus('idle');
            return;
        }

        void reload();
        return () => {
            sequenceRef.current += 1;
        };
    }, [enabled, localWorldRevision, reload]);

    return {
        ...snapshot,
        reload,
        status
    };
}
