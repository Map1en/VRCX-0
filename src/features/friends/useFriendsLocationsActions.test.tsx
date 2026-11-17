// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import type { LocalInstanceActionGates } from '@/shared/utils/invite';
import { useModalStore } from '@/state/modalStore';

import { useFriendsLocationsActions } from './useFriendsLocationsActions';

const mocks = vi.hoisted(() => ({
    sendInviteToLocation: vi.fn<() => Promise<void>>()
}));

vi.mock('@/services/inviteDeliveryService', () => ({
    sendBoopToUser: vi.fn(),
    sendInviteToLocation: mocks.sendInviteToLocation,
    sendRequestInviteToUser: vi.fn()
}));

const joinableLocation = 'wrld_a:1~friends(usr_owner)';
const lockedLocation = 'wrld_b:2~invite(usr_other)';

function gates(
    entries: Array<[location: string, canJoin: boolean]>
): Map<string, LocalInstanceActionGates> {
    return new Map(
        entries.map(([location, canJoin]) => [
            location,
            {
                key: location,
                canJoin,
                canOpenInGame: false,
                canSelfInvite: canJoin,
                canRequestInvite: true,
                canInvite: false
            }
        ])
    );
}

function renderActions(
    instanceActionGatesByLocation: Map<string, LocalInstanceActionGates>
) {
    const setCollapsedGroups = vi.fn();
    return renderHook(
        ({ gatesByLocation }) =>
            useFriendsLocationsActions({
                canInviteFromCurrentLocation: false,
                currentInviteLocation: '',
                currentUserId: 'usr_me',
                setCollapsedGroups,
                instanceActionGatesByLocation: gatesByLocation
            }),
        { initialProps: { gatesByLocation: instanceActionGatesByLocation } }
    );
}

describe('useFriendsLocationsActions', () => {
    it('keeps actions stable until the set of joinable locations changes', () => {
        const { result, rerender } = renderActions(
            gates([
                [joinableLocation, true],
                [lockedLocation, false]
            ])
        );
        const initialActions = result.current;
        expect(initialActions.canUseFriendLocation(joinableLocation)).toBe(
            true
        );
        expect(initialActions.canUseFriendLocation(lockedLocation)).toBe(false);

        rerender({
            gatesByLocation: gates([
                [lockedLocation, false],
                [joinableLocation, true]
            ])
        });
        expect(result.current).toBe(initialActions);

        rerender({
            gatesByLocation: gates([
                [joinableLocation, false],
                [lockedLocation, false]
            ])
        });
        expect(result.current).not.toBe(initialActions);
        expect(result.current.canUseFriendLocation(joinableLocation)).toBe(
            false
        );
        expect(result.current.openFriendUser).toBe(
            initialActions.openFriendUser
        );
    });

    it('sends invites to the latest current location through a handler captured earlier', async () => {
        mocks.sendInviteToLocation.mockReset().mockResolvedValue(undefined);
        useModalStore.setState({
            confirm: vi.fn().mockResolvedValue({ ok: true })
        });
        const { result, rerender } = renderHook(
            ({ currentInviteLocation }) =>
                useFriendsLocationsActions({
                    canInviteFromCurrentLocation: true,
                    currentInviteLocation,
                    currentUserId: 'usr_me',
                    setCollapsedGroups: vi.fn(),
                    instanceActionGatesByLocation: gates([])
                }),
            { initialProps: { currentInviteLocation: 'wrld_old:1' } }
        );
        const sendFriendInvite = result.current.sendFriendInvite;

        rerender({ currentInviteLocation: 'wrld_new:2' });
        await sendFriendInvite({ id: 'usr_friend' } as FriendRecord);

        expect(mocks.sendInviteToLocation).toHaveBeenCalledWith(
            expect.objectContaining({
                receiverUserId: 'usr_friend',
                worldId: 'wrld_new'
            })
        );
    });
});
