// @ts-nocheck
import { AvatarDetailsDialog } from '@/components/dialogs/AvatarDetailsDialog';
import { AvatarContentTagsDialog } from '@/components/dialogs/AvatarOwnerEditDialogs';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';

import { ManageAvatarTagsDialog } from '../ManageAvatarTagsDialog';

export function MyAvatarsDialogs({
    t,
    editDetailsAvatar,
    contentTagsAvatar,
    imageCropRequest,
    manageTagsAvatar,
    savingTagsAvatarId,
    currentUserId,
    currentEndpoint,
    onEditDetailsOpenChange,
    onContentTagsOpenChange,
    onImageCropOpenChange,
    onImageCropConfirm,
    onManageTagsOpenChange,
    onSaveTags,
    onEditDetailsSaved,
    onContentTagsSaved
}) {
    return (
        <>
            <AvatarDetailsDialog
                open={Boolean(editDetailsAvatar)}
                avatar={editDetailsAvatar}
                endpoint={currentEndpoint}
                onOpenChange={onEditDetailsOpenChange}
                onSavedCurrentAvatar={onEditDetailsSaved}
            />
            <AvatarContentTagsDialog
                open={Boolean(contentTagsAvatar)}
                avatar={contentTagsAvatar}
                currentUserId={currentUserId}
                endpoint={currentEndpoint}
                onOpenChange={onContentTagsOpenChange}
                onSavedCurrentAvatar={onContentTagsSaved}
            />
            <ImageCropDialog
                open={Boolean(imageCropRequest)}
                file={imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title={t('view.my_avatars.action.change_avatar_image')}
                onOpenChange={onImageCropOpenChange}
                onConfirm={onImageCropConfirm}
            />
            <ManageAvatarTagsDialog
                open={Boolean(manageTagsAvatar)}
                avatar={manageTagsAvatar}
                saving={Boolean(savingTagsAvatarId)}
                onOpenChange={onManageTagsOpenChange}
                onSave={onSaveTags}
            />
        </>
    );
}
