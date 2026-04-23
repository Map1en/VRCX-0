import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';

import { AvatarStylesDialog } from '../AvatarStylesDialog.jsx';
import { ManageAvatarTagsDialog } from '../ManageAvatarTagsDialog.jsx';

export function MyAvatarsDialogs({
    t,
    imageCropRequest,
    manageTagsAvatar,
    savingTagsAvatarId,
    stylesAvatar,
    currentUserId,
    currentEndpoint,
    onImageCropOpenChange,
    onImageCropConfirm,
    onManageTagsOpenChange,
    onSaveTags,
    onStylesOpenChange,
    onStylesSaved
}) {
    return (
        <>
            <ImageCropDialog
                open={Boolean(imageCropRequest)}
                file={imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title={t('view.my_avatars.generated.change_avatar_image')}
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
            <AvatarStylesDialog
                open={Boolean(stylesAvatar)}
                avatar={stylesAvatar}
                currentUserId={currentUserId}
                endpoint={currentEndpoint}
                onOpenChange={onStylesOpenChange}
                onSaved={onStylesSaved}
            />
        </>
    );
}
