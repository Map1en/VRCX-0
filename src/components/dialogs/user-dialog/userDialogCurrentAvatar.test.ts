import { describe, expect, it } from 'vitest';

import { mergeCurrentAvatarProfile } from './userDialogCurrentAvatar';

describe('mergeCurrentAvatarProfile', () => {
    it('hydrates an unknown current avatar name and image fields', () => {
        const profile = {
            id: 'usr_target',
            currentAvatar: 'avtr_current',
            currentAvatarName: 'Unknown Avatar',
            currentAvatarImageUrl: 'https://example.test/old.png'
        };

        expect(
            mergeCurrentAvatarProfile(profile, {
                id: 'avtr_current',
                name: 'Known Avatar',
                imageUrl: 'https://example.test/full.png',
                thumbnailImageUrl: 'https://example.test/thumb.png'
            })
        ).toEqual({
            ...profile,
            currentAvatarName: 'Known Avatar',
            currentAvatarImageUrl: 'https://example.test/full.png',
            currentAvatarThumbnailImageUrl: 'https://example.test/thumb.png'
        });
    });

    it('keeps the profile identity when avatar ids do not match', () => {
        const profile = {
            id: 'usr_target',
            currentAvatar: 'avtr_current',
            currentAvatarName: 'Current Avatar'
        };

        expect(
            mergeCurrentAvatarProfile(profile, {
                id: 'avtr_other',
                name: 'Other Avatar'
            })
        ).toBe(profile);
    });
});
