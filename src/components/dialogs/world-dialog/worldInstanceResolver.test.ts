import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: {
        getInstanceShortName: vi.fn()
    }
}));

import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';

import { resolveCreatedInstanceDetails } from './worldInstanceResolver';

describe('worldInstanceResolver', () => {
    beforeEach(() => {
        vi.mocked(vrchatInstanceRepository.getInstanceShortName).mockReset();
    });

    it('resolves short names for created instances and falls back on lookup failure', async () => {
        vi.mocked(
            vrchatInstanceRepository.getInstanceShortName
        ).mockResolvedValueOnce({
            json: {
                shortName: 'short_lookup',
                secureName: 'secure_lookup'
            }
        });

        await expect(
            resolveCreatedInstanceDetails(
                'wrld_test:123~region(us)',
                {},
                'https://api.example.test',
                { accessType: 'public', ownerId: 'usr_owner' }
            )
        ).resolves.toMatchObject({
            shortName: 'short_lookup',
            secureOrShortName: 'short_lookup',
            accessType: 'public',
            ownerId: 'usr_owner'
        });
        expect(
            vrchatInstanceRepository.getInstanceShortName
        ).toHaveBeenCalledWith({
            worldId: 'wrld_test',
            instanceId: '123~region(us)',
            endpoint: 'https://api.example.test'
        });

        vi.mocked(
            vrchatInstanceRepository.getInstanceShortName
        ).mockRejectedValueOnce(new Error('offline'));
        await expect(
            resolveCreatedInstanceDetails(
                'wrld_test:124~region(us)',
                { secureName: 'secure_fallback' },
                'https://api.example.test',
                { accessType: 'public' }
            )
        ).resolves.toMatchObject({
            shortName: '',
            secureOrShortName: 'secure_fallback',
            accessType: 'public'
        });
    });

    it('skips short-name lookup when response already includes a short name', async () => {
        await expect(
            resolveCreatedInstanceDetails(
                'wrld_test:125~region(us)',
                {
                    shortName: 'already_short',
                    accessType: 'invite'
                },
                'https://api.example.test',
                {
                    accessType: 'public',
                    ownerId: 'usr_fallback'
                }
            )
        ).resolves.toMatchObject({
            shortName: 'already_short',
            secureOrShortName: 'already_short',
            accessType: 'invite',
            ownerId: 'usr_fallback'
        });
        expect(
            vrchatInstanceRepository.getInstanceShortName
        ).not.toHaveBeenCalled();
    });
});
