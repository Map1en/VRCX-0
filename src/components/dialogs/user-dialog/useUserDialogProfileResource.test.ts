// @ts-nocheck
import { describe, expect, it } from 'vitest';

import {
    mergeLocalSnapshotIntoProfile,
    mergeUserDialogLocalSnapshot
} from './useUserDialogProfileResource.js';

describe('mergeLocalSnapshotIntoProfile', () => {
    it('refreshes presence fields without erasing full profile fields', () => {
        const profile = {
            id: 'usr_target',
            displayName: 'Target',
            bio: 'Full profile bio',
            bioLinks: ['https://example.test'],
            date_joined: '2024-05-19',
            status: 'active',
            location: 'private'
        };
        const localSnapshot = {
            id: 'usr_target',
            displayName: 'Target',
            status: 'join me',
            location: 'wrld_live:12345',
            bio: '',
            date_joined: ''
        };

        expect(mergeLocalSnapshotIntoProfile(localSnapshot, profile)).toEqual({
            ...profile,
            status: 'join me',
            location: 'wrld_live:12345'
        });
    });

    it('does not clear profile presence with normalized empty snapshot defaults', () => {
        const profile = {
            id: 'usr_target',
            displayName: 'Target',
            bio: 'Full profile bio',
            status: 'active',
            location: 'wrld_profile:12345'
        };
        const localSnapshot = {
            id: 'usr_target',
            displayName: 'Target',
            status: '',
            location: ''
        };

        expect(mergeLocalSnapshotIntoProfile(localSnapshot, profile)).toEqual(
            profile
        );
    });

    it('keeps seed profile details when a friend snapshot provides fresher presence', () => {
        const seedData = {
            id: 'usr_target',
            displayName: 'Target',
            bio: 'Full profile bio',
            bioLinks: ['https://example.test'],
            date_joined: '2024-05-19',
            status: 'active',
            location: 'private'
        };
        const friendSnapshot = {
            id: 'usr_target',
            displayName: 'Target',
            status: 'join me',
            location: 'wrld_live:12345',
            bio: '',
            date_joined: ''
        };

        expect(
            mergeUserDialogLocalSnapshot({
                friendSnapshot,
                seedData,
                knownTargetUser: null
            })
        ).toEqual({
            ...seedData,
            status: 'join me',
            location: 'wrld_live:12345'
        });
    });
});
