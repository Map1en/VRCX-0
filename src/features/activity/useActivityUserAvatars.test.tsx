// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFriendRosterStore } from '@/state/friendRosterStore';

const mocks = vi.hoisted(() => ({ getUserProfile: vi.fn() }));

vi.mock('@/repositories/userProfileRepository', () => ({
    default: { getUserProfile: mocks.getUserProfile }
}));
vi.mock('@/services/entityMediaService', async () => ({
    userImage: (await import('@/shared/utils/entityMedia')).userImage
}));

import { useActivityUserAvatars } from './useActivityUserAvatars';

const KNOWN_IMAGE = 'https://images.example.test/known.png';
const FETCHED_IMAGE = 'https://images.example.test/fetched.png';

beforeEach(() => {
    mocks.getUserProfile
        .mockReset()
        .mockResolvedValue({ iconUrl: FETCHED_IMAGE });
    useFriendRosterStore.getState().resetRoster();
    useFriendRosterStore.getState().applyFriendPatches([
        { userId: 'usr_known', patch: { iconUrl: KNOWN_IMAGE } },
        { userId: 'usr_missing', patch: { iconUrl: '' } }
    ]);
});

afterEach(cleanup);

describe('useActivityUserAvatars', () => {
    it('only fetches missing friend and nonfriend avatars', async () => {
        const { result } = renderHook(() =>
            useActivityUserAvatars(['usr_known', 'usr_missing', 'usr_stranger'])
        );
        await act(async () => {});

        expect(mocks.getUserProfile.mock.calls).toEqual([
            [{ userId: 'usr_missing' }],
            [{ userId: 'usr_stranger' }]
        ]);
        expect(result.current('usr_known')).toBe(KNOWN_IMAGE);
        expect(result.current('usr_missing')).toBe(FETCHED_IMAGE);
        expect(result.current('usr_stranger')).toBe(FETCHED_IMAGE);
    });

    it('keeps a pending avatar request through unrelated presence changes', async () => {
        const pending = Promise.withResolvers<{ iconUrl: string }>();
        mocks.getUserProfile.mockReturnValue(pending.promise);
        const { result } = renderHook(() =>
            useActivityUserAvatars(['usr_known', 'usr_missing'])
        );

        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_known',
                presence: { rev: 1, view: { kind: 'active', platform: 'web' } }
            });
        });
        await act(async () => pending.resolve({ iconUrl: FETCHED_IMAGE }));

        expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
        expect(result.current('usr_missing')).toBe(FETCHED_IMAGE);
    });

    it('fetches a fallback if the known avatar disappears and prefers later roster images', async () => {
        const { result } = renderHook(() =>
            useActivityUserAvatars(['usr_known'])
        );
        expect(mocks.getUserProfile).not.toHaveBeenCalled();

        await act(async () => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_known',
                patch: { iconUrl: '' }
            });
        });
        expect(mocks.getUserProfile).toHaveBeenCalledExactlyOnceWith({
            userId: 'usr_known'
        });
        expect(result.current('usr_known')).toBe(FETCHED_IMAGE);

        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_known',
                patch: { iconUrl: KNOWN_IMAGE }
            });
        });
        expect(result.current('usr_known')).toBe(KNOWN_IMAGE);
        expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    });

    it('reuses pending requests when another avatar becomes available', async () => {
        const pending = Promise.withResolvers<{ iconUrl: string }>();
        mocks.getUserProfile.mockReturnValue(pending.promise);
        const { result } = renderHook(() =>
            useActivityUserAvatars(['usr_missing', 'usr_stranger'])
        );
        expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);

        act(() => {
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_missing',
                patch: { iconUrl: KNOWN_IMAGE }
            });
        });
        expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);

        await act(async () => pending.resolve({ iconUrl: FETCHED_IMAGE }));
        expect(result.current('usr_missing')).toBe(KNOWN_IMAGE);
        expect(result.current('usr_stranger')).toBe(FETCHED_IMAGE);
    });
});
