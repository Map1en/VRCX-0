// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';

import type { MyAvatarsSource } from './myAvatarsTypes';
import { useMyAvatarsRows } from './useMyAvatarsRows';

const mocks = vi.hoisted(() => ({
    getMyAvatars: vi.fn(),
    getLicensedAvatars: vi.fn()
}));

vi.mock('@/repositories/myAvatarRepository', () => ({
    default: { getMyAvatars: mocks.getMyAvatars }
}));
vi.mock('@/repositories/vrchatEconomyRepository', () => ({
    default: { getLicensedAvatars: mocks.getLicensedAvatars }
}));

function changeAvatar(currentAvatar: string, previousAvatarSwapTime: number) {
    useRuntimeStore.setState((state) => ({
        auth: {
            ...state.auth,
            currentUserSnapshot: {
                ...state.auth.currentUserSnapshot,
                currentAvatar,
                $previousAvatarSwapTime: previousAvatarSwapTime
            }
        }
    }));
}

beforeEach(() => {
    mocks.getMyAvatars.mockReset().mockResolvedValue([]);
    mocks.getLicensedAvatars.mockReset().mockResolvedValue([]);
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId: 'usr_self' }
    }));
    changeAvatar('avtr_first', 10);
});

afterEach(cleanup);

describe('useMyAvatarsRows', () => {
    it('does not reload licensed avatars on an avatar change after manual refresh', async () => {
        const { result, rerender } = renderHook(
            ({ source }: { source: MyAvatarsSource }) =>
                useMyAvatarsRows(source),
            { initialProps: { source: 'licensed' } }
        );
        await act(async () => {});
        await act(async () => result.current.refresh());
        expect(mocks.getLicensedAvatars).toHaveBeenCalledTimes(2);
        expect(mocks.getLicensedAvatars).toHaveBeenLastCalledWith({
            userId: 'usr_self',
            force: true
        });

        await act(async () => changeAvatar('avtr_second', 20));
        expect(mocks.getLicensedAvatars).toHaveBeenCalledTimes(2);
        expect(mocks.getMyAvatars).not.toHaveBeenCalled();

        await act(async () => rerender({ source: 'own' }));
        expect(mocks.getMyAvatars).toHaveBeenCalledExactlyOnceWith({
            currentUserId: 'usr_self',
            currentAvatarId: 'avtr_second',
            previousAvatarSwapTime: 20
        });
    });

    it('continues refreshing owned avatar usage after an avatar change', async () => {
        renderHook(() => useMyAvatarsRows('own'));
        await act(async () => {});
        await act(async () => changeAvatar('avtr_second', 20));

        expect(mocks.getMyAvatars).toHaveBeenCalledTimes(2);
        expect(mocks.getMyAvatars).toHaveBeenLastCalledWith({
            currentUserId: 'usr_self',
            currentAvatarId: 'avtr_second',
            previousAvatarSwapTime: 20
        });
        expect(mocks.getLicensedAvatars).not.toHaveBeenCalled();
    });
});
