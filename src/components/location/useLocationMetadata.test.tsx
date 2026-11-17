// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const WORLD_ID = 'wrld_11111111-1111-1111-1111-111111111111';
const SECOND_WORLD_ID = 'wrld_22222222-2222-2222-2222-222222222222';

const mocks = vi.hoisted(() => ({
    getWorldNameByWorldId: vi.fn(),
    getWorldProfile: vi.fn(),
    groupProfilesById: new Map(),
    locationHintState: {
        hintsByKey: {}
    },
    runtimeState: {
        auth: {
            currentUserEndpoint: 'https://api.example.test/api/1',
            currentUserId: 'usr_self'
        },
        groupInstances: {
            userId: 'usr_self',
            endpoint: 'https://api.example.test/api/1',
            instances: [],
            lastLoadedAt: '',
            fetchedAt: '',
            status: 'ready'
        }
    }
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@tanstack/react-query')>();
    return {
        ...actual,
        useQueries: () => ({
            groupProfilesById: mocks.groupProfilesById,
            pendingGroupIds: new Set()
        })
    };
});

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        getWorldNameByWorldId: mocks.getWorldNameByWorldId
    }
}));

vi.mock('@/repositories/groupProfileRepository', () => ({
    default: {
        fetchGroupProfile: vi.fn()
    }
}));

vi.mock('@/repositories/worldProfileRepository', () => ({
    default: {
        getWorldProfile: mocks.getWorldProfile
    }
}));

vi.mock('@/state/locationHintStore', () => ({
    useLocationHintStore: (
        selector: (state: { hintsByKey: Record<string, unknown> }) => unknown
    ) => selector(mocks.locationHintState)
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: typeof mocks.runtimeState) => unknown
    ) => selector(mocks.runtimeState)
}));

import { parseLocation } from '@/shared/utils/location';

import {
    useLocationMetadata,
    useLocationMetadataBatch
} from './useLocationMetadata';

function metadataEntries(worldIds: readonly string[] = [WORLD_ID]) {
    return worldIds.map((worldId) => ({
        key: `friend:${worldId}`,
        currentLocation: `${worldId}:12345`
    }));
}

describe('useLocationMetadataBatch', () => {
    beforeEach(() => {
        mocks.getWorldNameByWorldId.mockReset();
        mocks.getWorldProfile.mockReset();
        mocks.getWorldNameByWorldId.mockResolvedValue('');
    });

    it('retains resolved world names and avoids duplicate IPC for the same ids', async () => {
        mocks.getWorldProfile.mockResolvedValueOnce({
            id: WORLD_ID,
            name: 'Stable World'
        });
        mocks.getWorldProfile.mockImplementationOnce(
            () => new Promise(() => undefined)
        );

        const { result, rerender } = renderHook(
            ({ entries }) => useLocationMetadataBatch(entries),
            {
                initialProps: { entries: metadataEntries() }
            }
        );

        await waitFor(() => {
            expect(result.current.get(`friend:${WORLD_ID}`)?.worldName).toBe(
                'Stable World'
            );
        });
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(1);

        rerender({ entries: metadataEntries() });

        expect(result.current.get(`friend:${WORLD_ID}`)?.worldName).toBe(
            'Stable World'
        );
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(1);
    });

    it('keeps metadata objects for unchanged entries when other entries change', async () => {
        mocks.getWorldProfile.mockResolvedValueOnce({
            id: WORLD_ID,
            name: 'Stable World'
        });
        mocks.getWorldProfile.mockImplementation(
            () => new Promise(() => undefined)
        );
        const { result, rerender } = renderHook(
            ({ entries }) => useLocationMetadataBatch(entries),
            { initialProps: { entries: metadataEntries() } }
        );
        await waitFor(() => {
            expect(result.current.get(`friend:${WORLD_ID}`)?.worldName).toBe(
                'Stable World'
            );
        });
        const stableMetadata = result.current.get(`friend:${WORLD_ID}`);

        rerender({ entries: metadataEntries([WORLD_ID, SECOND_WORLD_ID]) });

        expect(result.current.get(`friend:${WORLD_ID}`)).toBe(stableMetadata);
        expect(
            result.current.get(`friend:${SECOND_WORLD_ID}`)?.worldNamePending
        ).toBe(true);
    });

    it('keeps the world name pending until both lookups settle without a name', async () => {
        let rejectProfile!: (error: Error) => void;
        mocks.getWorldProfile.mockReturnValueOnce(
            new Promise((_, reject) => {
                rejectProfile = reject;
            })
        );

        const { result } = renderHook(() =>
            useLocationMetadataBatch(metadataEntries())
        );

        await waitFor(() => {
            expect(mocks.getWorldNameByWorldId).toHaveBeenCalledTimes(1);
        });
        expect(result.current.get(`friend:${WORLD_ID}`)?.worldNamePending).toBe(
            true
        );

        rejectProfile(new Error('offline'));

        await waitFor(() => {
            expect(
                result.current.get(`friend:${WORLD_ID}`)?.worldNamePending
            ).toBe(false);
        });
        expect(result.current.get(`friend:${WORLD_ID}`)?.worldName).toBe('');
    });

    it('treats reordered world ids as the same request set', async () => {
        mocks.getWorldProfile
            .mockResolvedValueOnce({ id: WORLD_ID, name: 'First World' })
            .mockResolvedValueOnce({
                id: SECOND_WORLD_ID,
                name: 'Second World'
            });

        const { result, rerender } = renderHook(
            ({ entries }) => useLocationMetadataBatch(entries),
            {
                initialProps: {
                    entries: metadataEntries([WORLD_ID, SECOND_WORLD_ID])
                }
            }
        );

        await waitFor(() => {
            expect(
                result.current.get(`friend:${SECOND_WORLD_ID}`)?.worldName
            ).toBe('Second World');
        });
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(2);

        rerender({
            entries: metadataEntries([SECOND_WORLD_ID, WORLD_ID])
        });

        expect(result.current.get(`friend:${WORLD_ID}`)?.worldName).toBe(
            'First World'
        );
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(2);
    });

    it('retains existing names while requesting only newly added ids', async () => {
        let resolveSecondWorld!: (profile: {
            id: string;
            name: string;
        }) => void;
        const secondWorldRequest = new Promise<{ id: string; name: string }>(
            (resolve) => {
                resolveSecondWorld = resolve;
            }
        );
        mocks.getWorldProfile
            .mockResolvedValueOnce({ id: WORLD_ID, name: 'First World' })
            .mockReturnValueOnce(secondWorldRequest);

        const { result, rerender } = renderHook(
            ({ entries }) => useLocationMetadataBatch(entries),
            {
                initialProps: { entries: metadataEntries() }
            }
        );

        await waitFor(() => {
            expect(result.current.get(`friend:${WORLD_ID}`)?.worldName).toBe(
                'First World'
            );
        });

        rerender({
            entries: metadataEntries([WORLD_ID, SECOND_WORLD_ID])
        });

        expect(result.current.get(`friend:${WORLD_ID}`)?.worldName).toBe(
            'First World'
        );
        expect(mocks.getWorldProfile).toHaveBeenCalledTimes(2);
        expect(mocks.getWorldProfile).toHaveBeenLastCalledWith({
            worldId: SECOND_WORLD_ID
        });

        resolveSecondWorld({
            id: SECOND_WORLD_ID,
            name: 'Second World'
        });
        await waitFor(() => {
            expect(
                result.current.get(`friend:${SECOND_WORLD_ID}`)?.worldName
            ).toBe('Second World');
        });
    });

    it('looks up the local world name once while a caller passes a fresh location object every render', async () => {
        mocks.getWorldProfile.mockImplementation(
            () => new Promise(() => undefined)
        );

        renderHook(() =>
            useLocationMetadata({
                locationInfo: parseLocation(`${WORLD_ID}:12345`),
                currentLocation: `${WORLD_ID}:12345`
            })
        );

        await waitFor(() => {
            expect(mocks.getWorldNameByWorldId).toHaveBeenCalledTimes(1);
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(mocks.getWorldNameByWorldId).toHaveBeenCalledTimes(1);
    });
});
