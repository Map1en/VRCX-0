import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./FriendsSidebarFriendRow', () => ({
    FriendRow: ({
        appearance,
        rowModel
    }: {
        appearance: { currentLocationStartedAt?: string | number | null };
        rowModel: {
            canRequestInvite?: boolean;
            instanceLocation?: string;
            locationTime?: { location?: string | null } | null;
        };
    }) => (
        <button
            disabled={!rowModel.canRequestInvite}
            data-current-location-started-at={String(
                appearance.currentLocationStartedAt ?? ''
            )}
            data-instance-location={rowModel.instanceLocation || ''}
            data-projected-location={rowModel.locationTime?.location || ''}
        >
            Request invite
        </button>
    )
}));

import { FriendsSidebarVirtualRow } from './FriendsSidebarVirtualRows';

type VirtualRowProps = ComponentProps<typeof FriendsSidebarVirtualRow>;

function renderFriendRow({
    currentLocationStartedAt = null,
    instanceLocation,
    projectedLocation,
    isCurrentUser = false,
    state = 'offline'
}: {
    currentLocationStartedAt?: string | number | null;
    instanceLocation?: string;
    projectedLocation?: string;
    isCurrentUser?: boolean;
    state?: string;
}) {
    const props: VirtualRowProps = {
        appearance: {},
        friendCommands: {
            onOpenFriend: vi.fn(),
            onToggleSection: vi.fn()
        },
        location: {
            locationMetadataByKey: new Map(),
            locationTimesByUserId: projectedLocation
                ? {
                      usr_friend: {
                          location: projectedLocation,
                          source: 'realtime',
                          sinceMs: 1_700_000_000_000
                      }
                  }
                : {}
        },
        row: {
            type: 'friend',
            key: 'friend:test',
            friend: { id: 'usr_friend', state },
            isCurrentUser,
            instanceLocation
        },
        runtime: {
            currentUser: null,
            currentUserId: 'usr_current',
            gameState: { isGameRunning: false, currentLocationStartedAt },
            onlineIdSet: new Set(),
            instanceActionGatesByUserId: new Map([
                [
                    'usr_friend',
                    {
                        key: 'usr_friend',
                        canJoin: false,
                        canOpenInGame: false,
                        canSelfInvite: false,
                        canRequestInvite: false,
                        canInvite: false
                    }
                ]
            ])
        },
        statusCommands: {}
    };

    return renderToStaticMarkup(<FriendsSidebarVirtualRow {...props} />);
}

describe('FriendsSidebarVirtualRow request invite action', () => {
    it.each(['online', 'offline'])(
        'keeps request invite enabled for a %s friend regardless of instance gates',
        (state) => {
            expect(renderFriendRow({ state })).not.toContain('disabled=""');
        }
    );

    it('keeps request invite unavailable for the current user', () => {
        expect(renderFriendRow({ isCurrentUser: true })).toContain(
            'disabled=""'
        );
    });

    it('passes the local room start time through for the current-user row', () => {
        expect(
            renderFriendRow({
                isCurrentUser: true,
                currentLocationStartedAt: 1_700_000_000_000
            })
        ).toContain('data-current-location-started-at="1700000000000"');
    });

    it('passes the same-instance room through for a friend row', () => {
        expect(renderFriendRow({ instanceLocation: 'wrld_live:1' })).toContain(
            'data-instance-location="wrld_live:1"'
        );
    });

    it('passes the backend-projected location through for a friend row', () => {
        expect(
            renderFriendRow({ projectedLocation: 'wrld_current:123' })
        ).toContain('data-projected-location="wrld_current:123"');
    });
});
