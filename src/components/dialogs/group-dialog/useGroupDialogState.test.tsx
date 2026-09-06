// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupProfileRecord } from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';

const mocks = vi.hoisted(() => ({
    enrichEntityDialogHistory: vi.fn(),
    getGroupProfile: vi.fn(),
    getPreviousInstancesByGroupId: vi.fn(),
    normalize: vi.fn(),
    recordLocationHintsFromInstances: vi.fn(),
    updateEntityDialogMetadata: vi.fn()
}));

const translate = (key: string) => key;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate })
}));

vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn()
    }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        getPreviousInstancesByGroupId: mocks.getPreviousInstancesByGroupId
    }
}));

vi.mock('@/repositories/groupProfileRepository', () => ({
    default: {
        getGroupProfile: mocks.getGroupProfile,
        normalize: mocks.normalize
    }
}));

vi.mock('@/services/dialogService', () => ({
    enrichEntityDialogHistory: mocks.enrichEntityDialogHistory
}));

vi.mock('@/services/domainIngestionService', () => ({
    recordLocationHintsFromInstances: mocks.recordLocationHintsFromInstances
}));

vi.mock('@/services/entityMediaService', () => ({
    convertFileUrlToImageUrl: (url: string) => url
}));

vi.mock('@/state/dialogStore', () => ({
    useDialogStore: <T,>(
        selector: (state: {
            updateEntityDialogMetadata: typeof mocks.updateEntityDialogMetadata;
        }) => T
    ): T =>
        selector({
            updateEntityDialogMetadata: mocks.updateEntityDialogMetadata
        })
}));

vi.mock('@/state/friendRosterStore', () => ({
    useFriendRosterStore: <T,>(
        selector: (state: { friendsById: Record<string, never> }) => T
    ): T => selector({ friendsById: {} })
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: { confirm: ReturnType<typeof vi.fn> }) => T
    ): T => selector({ confirm: vi.fn() })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            auth: {
                currentUserEndpoint: string;
                currentUserId: string;
                currentUserSnapshot: null;
            };
            gameState: { currentLocation: string };
            groupInstances: {
                endpoint: string;
                instances: Array<Record<string, unknown>>;
                userId: string;
            };
        }) => T
    ): T =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.example.test',
                currentUserId: 'usr_current',
                currentUserSnapshot: null
            },
            gameState: { currentLocation: '' },
            groupInstances: {
                endpoint: 'https://api.example.test',
                instances: [
                    {
                        group: { id: 'grp_test' },
                        instance: {
                            capacity: 60,
                            location: 'wrld_open:1~group(grp_test)',
                            userCount: 0
                        }
                    },
                    {
                        active: false,
                        group: { id: 'grp_test' },
                        location: 'wrld_closed:1~group(grp_test)'
                    },
                    {
                        group: { id: 'grp_other' },
                        location: 'wrld_other:1~group(grp_other)'
                    }
                ],
                userId: 'usr_current'
            }
        })
}));

import { useGroupDialogState } from './useGroupDialogState';

const baseGroup: GroupProfileRecord = {
    bannerUrl: '',
    description: '',
    discriminator: '',
    displayName: 'Seed group',
    iconUrl: '',
    id: 'grp_test',
    languages: [],
    links: [],
    memberCount: 1,
    membershipStatus: 'member',
    name: 'Seed group',
    onlineMemberCount: 0,
    ownerDisplayName: 'Owner',
    ownerId: 'usr_owner',
    privacy: 'default',
    roles: [],
    rules: '',
    shortCode: 'TEST',
    tags: [],
    url: ''
};

describe('useGroupDialogState instance loading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.normalize.mockImplementation(
            (value: EntityRecord): GroupProfileRecord => ({
                ...baseGroup,
                ...value
            })
        );
        mocks.getGroupProfile.mockResolvedValue({
            ...baseGroup,
            displayName: 'Remote group',
            name: 'Remote group'
        });
        mocks.getPreviousInstancesByGroupId.mockResolvedValue(new Map());
    });

    it('uses the shared runtime group instance projection', async () => {
        const { result } = renderHook(() =>
            useGroupDialogState({
                groupId: 'grp_test',
                seedData: baseGroup
            })
        );

        await waitFor(() => {
            expect(mocks.getGroupProfile).toHaveBeenCalledOnce();
            expect(mocks.updateEntityDialogMetadata).toHaveBeenCalledWith(
                expect.objectContaining({ title: 'Remote group' })
            );
        });

        expect(result.current).toMatchObject({
            activeInstances: [
                {
                    capacity: 60,
                    location: 'wrld_open:1~group(grp_test)',
                    userCount: 0
                }
            ]
        });
    });
});
