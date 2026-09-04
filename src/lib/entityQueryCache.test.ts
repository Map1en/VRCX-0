import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearEntityQueryCache,
    entityQueryPolicies,
    getEntityQueryCacheStats,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';

describe('entityQueryCache', () => {
    afterEach(async () => {
        await clearEntityQueryCache();
        vi.useRealTimers();
    });

    it('builds stable query keys with sorted params and normalized endpoints', () => {
        expect(
            queryKeys.worldsByUser(
                {
                    userId: 'usr_123',
                    offset: 100,
                    n: 50,
                    sort: 'updated',
                    order: 'descending',
                    releaseStatus: 'all'
                },
                'https://api.example.test///'
            )
        ).toEqual([
            'worlds',
            'user',
            'usr_123',
            {
                n: 50,
                offset: 100,
                order: 'descending',
                releaseStatus: 'all',
                sort: 'updated',
                userId: 'usr_123'
            },
            {
                endpoint: 'https://api.example.test'
            }
        ]);

        expect(
            queryKeys.worldPersistData({
                worldId: 'wrld_123',
                userId: 'usr_123'
            })
        ).toEqual(['world', 'wrld_123', 'persistData', 'usr_123']);
    });

    it('reports entity cache stats only for recognized entity ids', () => {
        setCachedQueryData(queryKeys.user('usr_1'), {});
        setCachedQueryData(queryKeys.user('not-a-user'), {});
        setCachedQueryData(queryKeys.avatarGallery('avtr_1'), []);
        setCachedQueryData(queryKeys.group('grp_1'), {});
        setCachedQueryData(['misc', 'usr_2'], {});

        expect(getEntityQueryCacheStats()).toEqual({
            users: 1,
            avatars: 1,
            groups: 1
        });
    });

    it('keeps instance reads live and file analysis cached for two hours', () => {
        expect(entityQueryPolicies.instance.staleTime).toBe(0);
        expect(entityQueryPolicies.fileAnalysis.staleTime).toBe(
            2 * 60 * 60 * 1000
        );
    });

    it('retains observed user profiles and releases them five minutes after the last observer leaves', async () => {
        vi.useFakeTimers();
        const key = queryKeys.user('usr_observed');
        const observer = new QueryObserver(queryClient, {
            queryKey: key,
            queryFn: async () => ({ id: 'usr_observed' }),
            ...entityQueryPolicies.userAvatarLookup
        });
        const unsubscribe = observer.subscribe(() => {});
        await observer.refetch();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(queryClient.getQueryData(key)).toEqual({ id: 'usr_observed' });
        unsubscribe();
        await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
        expect(queryClient.getQueryData(key)).toBeDefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(queryClient.getQueryData(key)).toBeUndefined();
    });
});
