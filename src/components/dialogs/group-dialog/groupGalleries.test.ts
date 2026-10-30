import { describe, expect, it } from 'vitest';

import type { GroupProfileRecord } from '@/domain/entities/group';

import {
    canDeleteGalleryImage,
    canManageGallery,
    canSubmitToGallery,
    groupGalleryAccess,
    groupGalleryVisibility
} from './groupGalleries';

const gallery = {
    id: 'ggal_1',
    roleIdsToManage: ['grol_mod'],
    roleIdsToSubmit: ['grol_artist']
};

function group(patch: Partial<GroupProfileRecord>): GroupProfileRecord {
    return {
        id: 'grp_1',
        ownerId: 'usr_owner',
        ...patch
    } as GroupProfileRecord;
}

describe('group gallery access', () => {
    it('lets owners and gallery managers manage, and submitters only add', () => {
        const owner = groupGalleryAccess(group({}), 'usr_owner');
        const moderator = groupGalleryAccess(
            group({ myMember: { roleIds: ['grol_mod'] } }),
            'usr_mod'
        );
        const artist = groupGalleryAccess(
            group({ myMember: { roleIds: ['grol_artist'] } }),
            'usr_artist'
        );
        const member = groupGalleryAccess(
            group({ myMember: { roleIds: [] } }),
            'usr_member'
        );

        expect(owner.manageAll).toBe(true);
        expect(canManageGallery(moderator, gallery)).toBe(true);
        expect(moderator.manageAll).toBe(false);
        expect(canManageGallery(artist, gallery)).toBe(false);
        expect(canSubmitToGallery(artist, gallery)).toBe(true);
        expect(canSubmitToGallery(member, gallery)).toBe(false);
    });

    it('grants gallery management through the role permission', () => {
        const access = groupGalleryAccess(
            group({
                myMember: { roleIds: ['grol_staff'] },
                roles: [
                    {
                        id: 'grol_staff',
                        permissions: ['group-galleries-manage']
                    }
                ]
            }),
            'usr_staff'
        );
        expect(access.manageAll).toBe(true);
    });

    it('lets submitters delete only their own images', () => {
        const artist = groupGalleryAccess(
            group({ myMember: { roleIds: ['grol_artist'] } }),
            'usr_artist'
        );
        expect(
            canDeleteGalleryImage(artist, gallery, {
                submittedByUserId: 'usr_artist'
            })
        ).toBe(true);
        expect(
            canDeleteGalleryImage(artist, gallery, {
                submittedByUserId: 'usr_other'
            })
        ).toBe(false);
    });

    it('reads visibility from membersOnly and view roles', () => {
        expect(groupGalleryVisibility({ id: 'a' })).toBe('public');
        expect(groupGalleryVisibility({ id: 'a', membersOnly: true })).toBe(
            'members'
        );
        expect(
            groupGalleryVisibility({
                id: 'a',
                membersOnly: true,
                roleIdsToView: ['grol_1']
            })
        ).toBe('roles');
    });
});
