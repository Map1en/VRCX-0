import type {
    GroupGalleryPhotoRow,
    GroupGallerySummary,
    GroupProfileRecord
} from '@/domain/entities/group';

import { hasGroupPermission } from './groupDialogUtils';

export type GroupGalleryAccess = {
    manageAll: boolean;
    roleIds: string[];
    userId: string;
};

export function groupGalleryAccess(
    group: GroupProfileRecord,
    currentUserId: string | null
): GroupGalleryAccess {
    return {
        manageAll:
            (Boolean(currentUserId) && group.ownerId === currentUserId) ||
            hasGroupPermission(group, 'group-galleries-manage'),
        roleIds: group.myMember?.roleIds ?? [],
        userId: currentUserId ?? ''
    };
}

function hasAnyRole(
    access: GroupGalleryAccess,
    roleIds: string[] | null | undefined
) {
    return Boolean(roleIds?.some((roleId) => access.roleIds.includes(roleId)));
}

export function canManageGallery(
    access: GroupGalleryAccess,
    gallery: GroupGallerySummary
) {
    return access.manageAll || hasAnyRole(access, gallery.roleIdsToManage);
}

export function canSubmitToGallery(
    access: GroupGalleryAccess,
    gallery: GroupGallerySummary
) {
    return (
        canManageGallery(access, gallery) ||
        hasAnyRole(access, gallery.roleIdsToSubmit)
    );
}

export function canDeleteGalleryImage(
    access: GroupGalleryAccess,
    gallery: GroupGallerySummary,
    row: GroupGalleryPhotoRow
) {
    return (
        canManageGallery(access, gallery) ||
        (Boolean(access.userId) && row.submittedByUserId === access.userId)
    );
}

export function groupGalleryVisibility(
    gallery: GroupGallerySummary
): 'public' | 'members' | 'roles' {
    if (!gallery.membersOnly) {
        return 'public';
    }
    return gallery.roleIdsToView?.length ? 'roles' : 'members';
}
