// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityRecord } from '@/domain/entities/shared';

const mocks = vi.hoisted(() => ({
    getMyAvatars: vi.fn(),
    getString: vi.fn(),
    getUserGroups: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/repositories/myAvatarRepository', () => ({
    default: { getMyAvatars: mocks.getMyAvatars }
}));
vi.mock('@/repositories/configRepository', () => ({
    default: { getString: mocks.getString, setString: vi.fn() }
}));
vi.mock('@/repositories/avatarSearchProviderRepository', () => ({
    default: {},
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS: []
}));
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: { getUserGroups: mocks.getUserGroups }
}));
vi.mock('@/repositories/userProfileRepository', () => ({ default: {} }));
vi.mock('@/repositories/vrchatFavoriteRepository', () => ({ default: {} }));
vi.mock('@/repositories/worldProfileRepository', () => ({ default: {} }));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appUserDialogTabCountsGet: vi.fn(async () => ({})) }
}));

import { useUserDialogTabData } from './useUserDialogTabData';

let resetActiveTab: (() => void) | undefined;

function renderCurrentUserTabs() {
    const hook = renderHook(() =>
        useUserDialogTabData({
            profile: { id: 'usr_self' },
            reloadToken: 0,
            isCurrentUser: true,
            currentEndpoint: 'https://api.example.test',
            currentUserId: 'usr_self',
            currentAvatarId: 'avtr_current',
            previousAvatarSwapTime: 0,
            currentUserHasSharedConnectionsOptOut: false,
            friendsById: {},
            inGameGroupOrder: []
        })
    );
    resetActiveTab = () => hook.result.current.changeTab('info');
    return hook;
}

describe('useUserDialogTabData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getMyAvatars.mockReset();
        mocks.getString.mockResolvedValue('name');
        mocks.getUserGroups.mockResolvedValue([]);
    });

    afterEach(() => {
        act(() => resetActiveTab?.());
        cleanup();
        resetActiveTab = undefined;
    });

    it.each(['before', 'after'])(
        'ignores an older avatar failure %s the saved-sort request succeeds',
        async (failureOrder) => {
            const older = Promise.withResolvers<EntityRecord[]>();
            const newer = Promise.withResolvers<EntityRecord[]>();
            const savedSort = Promise.withResolvers<string>();
            mocks.getString.mockReturnValue(savedSort.promise);
            mocks.getMyAvatars
                .mockReturnValueOnce(older.promise)
                .mockReturnValueOnce(newer.promise);
            const { result } = renderCurrentUserTabs();

            await act(async () => result.current.changeTab('avatars'));
            expect(mocks.getMyAvatars).toHaveBeenCalledTimes(1);
            await act(async () => savedSort.resolve('update'));
            expect(mocks.getMyAvatars).toHaveBeenCalledTimes(2);

            if (failureOrder === 'before') {
                await act(async () =>
                    older.reject(new Error('Older avatar request failed'))
                );
                expect(result.current.remoteStatus.avatars).toBe('running');
                expect(result.current.remoteErrors.avatars).toBe('');
            }

            const avatars = [{ id: 'avtr_loaded', name: 'Loaded avatar' }];
            await act(async () => newer.resolve(avatars));

            if (failureOrder === 'after') {
                await act(async () =>
                    older.reject(new Error('Older avatar request failed'))
                );
            }

            expect(result.current.remoteStatus.avatars).toBe('ready');
            expect(result.current.remoteErrors.avatars).toBe('');
            expect(result.current.visibleProfileAvatars).toEqual(avatars);
        }
    );

    it('keeps the latest avatar rows when an older matching request succeeds later', async () => {
        const older = Promise.withResolvers<EntityRecord[]>();
        const newer = Promise.withResolvers<EntityRecord[]>();
        mocks.getMyAvatars
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);
        const { result } = renderCurrentUserTabs();

        await act(async () => result.current.changeTab('avatars'));
        act(() => {
            void result.current.loadTab('avatars', { force: true });
        });
        expect(mocks.getMyAvatars).toHaveBeenCalledTimes(2);

        const avatars = [{ id: 'avtr_new' }];
        await act(async () => newer.resolve(avatars));
        await act(async () => older.resolve([{ id: 'avtr_old' }]));

        expect(result.current.visibleProfileAvatars).toEqual(avatars);
        expect(result.current.remoteStatus.avatars).toBe('ready');
        expect(result.current.remoteErrors.avatars).toBe('');
    });

    it('preserves the latest avatar failure until a retry succeeds', async () => {
        const older = Promise.withResolvers<EntityRecord[]>();
        const newer = Promise.withResolvers<EntityRecord[]>();
        const retry = Promise.withResolvers<EntityRecord[]>();
        mocks.getMyAvatars
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise)
            .mockReturnValueOnce(retry.promise);
        const { result } = renderCurrentUserTabs();

        await act(async () => result.current.changeTab('avatars'));
        act(() => {
            void result.current.loadTab('avatars', { force: true });
        });
        await act(async () =>
            newer.reject(new Error('Latest avatar request failed'))
        );
        await act(async () => older.resolve([{ id: 'avtr_old' }]));

        expect(result.current.remoteStatus.avatars).toBe('error');
        expect(result.current.remoteErrors.avatars).toBe(
            'Latest avatar request failed'
        );
        expect(result.current.remoteData.avatars).toEqual([]);

        act(() => {
            void result.current.loadTab('avatars', { force: true });
        });
        const avatars = [{ id: 'avtr_retried' }];
        await act(async () => retry.resolve(avatars));

        expect(result.current.remoteStatus.avatars).toBe('ready');
        expect(result.current.remoteErrors.avatars).toBe('');
        expect(result.current.visibleProfileAvatars).toEqual(avatars);
    });

    it('allows different tabs to finish loading independently', async () => {
        const avatars = Promise.withResolvers<EntityRecord[]>();
        const groups = Promise.withResolvers<EntityRecord[]>();
        mocks.getMyAvatars.mockReturnValueOnce(avatars.promise);
        mocks.getUserGroups.mockReturnValueOnce(groups.promise);
        const { result } = renderCurrentUserTabs();

        await act(async () => result.current.changeTab('avatars'));
        await act(async () => result.current.changeTab('groups'));
        await act(async () => groups.resolve([{ id: 'grp_loaded' }]));
        await act(async () => avatars.resolve([{ id: 'avtr_loaded' }]));

        expect(result.current.remoteStatus.groups).toBe('ready');
        expect(result.current.remoteData.groups).toEqual([
            { id: 'grp_loaded' }
        ]);
        expect(result.current.remoteStatus.avatars).toBe('ready');
        expect(result.current.remoteData.avatars).toEqual([
            { id: 'avtr_loaded' }
        ]);
    });
});
