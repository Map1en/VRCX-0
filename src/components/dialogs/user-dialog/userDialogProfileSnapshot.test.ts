import { describe, expect, it } from 'vitest';

import {
    mergeActivityTimestampsIntoProfile,
    mergeSnapshotIntoCurrentProfile
} from './userDialogProfileSnapshot';

describe('mergeActivityTimestampsIntoProfile', () => {
    it('adopts a real timestamp reported by the snapshot', () => {
        const profile = {
            id: 'usr_1',
            last_activity: '2026-01-01T00:00:00.000Z'
        };

        const merged = mergeActivityTimestampsIntoProfile(profile, {
            id: 'usr_1',
            last_activity: '2026-02-01T00:00:00.000Z',
            last_login: '2026-02-02T00:00:00.000Z'
        });

        expect(merged).toMatchObject({
            last_activity: '2026-02-01T00:00:00.000Z',
            last_login: '2026-02-02T00:00:00.000Z'
        });
    });

    it('keeps the previously known timestamp when the snapshot omits the field', () => {
        const profile = {
            id: 'usr_1',
            last_activity: '2026-01-01T00:00:00.000Z'
        };

        const merged = mergeActivityTimestampsIntoProfile(profile, {
            id: 'usr_1'
        });

        expect(merged).toMatchObject({
            last_activity: '2026-01-01T00:00:00.000Z'
        });
    });

    it('keeps the previously known timestamp when the snapshot reports an explicit null', () => {
        // Friend-roster snapshots are unreliable (see OptionalCompactString on the
        // Rust side): a bare `null` there just means this particular payload
        // carried no activity data, not that VRChat confirmed the value is empty.
        // Regressing a known-good timestamp back to unknown on every roster patch
        // would make the profile flicker, so an explicit null must not overwrite it.
        const profile = {
            id: 'usr_1',
            last_activity: '2026-01-01T00:00:00.000Z'
        };

        const merged = mergeActivityTimestampsIntoProfile(profile, {
            id: 'usr_1',
            last_activity: null
        });

        expect(merged).toMatchObject({
            last_activity: '2026-01-01T00:00:00.000Z'
        });
    });

    it('ignores a snapshot for a different user', () => {
        const profile = {
            id: 'usr_1',
            last_activity: '2026-01-01T00:00:00.000Z'
        };

        const merged = mergeActivityTimestampsIntoProfile(profile, {
            id: 'usr_2',
            last_activity: '2026-03-01T00:00:00.000Z'
        });

        expect(merged).toBe(profile);
    });

    it('passes through a profile untouched when there is no snapshot to merge', () => {
        const profile = {
            id: 'usr_1',
            last_activity: '2026-01-01T00:00:00.000Z'
        };

        expect(mergeActivityTimestampsIntoProfile(profile, null)).toBe(profile);
        expect(mergeActivityTimestampsIntoProfile(null, { id: 'usr_1' })).toBe(
            null
        );
    });
});

describe('mergeSnapshotIntoCurrentProfile', () => {
    it('keeps profile-owned appearance fields over a stale current-user snapshot', () => {
        const previous = {
            id: 'usr_self',
            status: 'active',
            bannerType: 'customImage',
            bannerUrl: 'https://image/file_new/1/1024',
            bannerCustomUrl: 'https://files/file_new/1',
            userIcon: 'https://files/file_icon_new/1',
            bio: 'fresh bio'
        };
        const merged = mergeSnapshotIntoCurrentProfile({
            currentProfile: previous,
            isTargetCurrentUser: true,
            snapshot: {
                id: 'usr_self',
                status: 'busy',
                location: 'wrld_a:1',
                bannerType: 'avatarBanner',
                bannerUrl: 'https://image/file_old/1/1024',
                userIcon: 'https://files/file_icon_old/1'
            },
            targetUserId: 'usr_self'
        });

        expect(merged).toMatchObject({
            status: 'busy',
            location: 'wrld_a:1',
            bannerType: 'customImage',
            bannerUrl: 'https://image/file_new/1/1024',
            bannerCustomUrl: 'https://files/file_new/1',
            userIcon: 'https://files/file_icon_new/1',
            bio: 'fresh bio'
        });
    });

    it('still takes appearance fields from the snapshot when the dialog has none yet', () => {
        const merged = mergeSnapshotIntoCurrentProfile({
            currentProfile: null,
            isTargetCurrentUser: true,
            snapshot: {
                id: 'usr_self',
                bannerUrl: 'https://image/file_old/1/1024'
            },
            targetUserId: 'usr_self'
        });

        expect(merged?.bannerUrl).toBe('https://image/file_old/1/1024');
    });
});
