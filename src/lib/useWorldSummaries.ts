import { useEffect, useRef, useState } from 'react';

import worldProfileRepository from '@/repositories/worldProfileRepository';

export type WorldSummary = {
    name: string;
    thumbnailUrl: string;
};

export function useWorldSummaries(
    worldIds: readonly string[]
): ReadonlyMap<string, WorldSummary> {
    const [summaries, setSummaries] = useState<Map<string, WorldSummary>>(
        () => new Map()
    );
    const requestedRef = useRef(new Set<string>());
    const mountedRef = useRef(true);
    const worldIdsKey = worldIds.join(',');

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        const ids = worldIdsKey ? worldIdsKey.split(',') : [];
        const pending = ids.filter((id) => !requestedRef.current.has(id));
        if (!pending.length) {
            return;
        }
        for (const id of pending) {
            requestedRef.current.add(id);
        }
        void Promise.all(
            pending.map(async (worldId) => {
                try {
                    const profile =
                        await worldProfileRepository.getWorldProfile({
                            worldId
                        });
                    return [
                        worldId,
                        {
                            name: profile.name || '',
                            thumbnailUrl:
                                profile.imageUrl ||
                                profile.thumbnailImageUrl ||
                                ''
                        }
                    ] as const;
                } catch {
                    requestedRef.current.delete(worldId);
                    return [worldId, { name: '', thumbnailUrl: '' }] as const;
                }
            })
        ).then((entries) => {
            if (!mountedRef.current) {
                return;
            }
            setSummaries((current) => {
                const next = new Map(current);
                for (const [worldId, summary] of entries) {
                    next.set(worldId, summary);
                }
                return next;
            });
        });
    }, [worldIdsKey]);

    return summaries;
}
