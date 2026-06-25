import { useTranslation } from 'react-i18next';

import { AvatarDetailsDialog } from '@/components/dialogs/AvatarDetailsDialog';
import { AvatarContentTagsDialog } from '@/components/dialogs/AvatarOwnerEditDialogs';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import { useRuntimeStore } from '@/state/runtimeStore';

import { ManageAvatarTagsDialog } from '../ManageAvatarTagsDialog';
import type {
    MyAvatarImageCropRequest,
    MyAvatarRow,
    MyAvatarTag
} from '../myAvatarsTypes';

type MyAvatarsDialogsProps = {
    editDetailsAvatar: MyAvatarRow | null;
    contentTagsAvatar: MyAvatarRow | null;
    imageCropRequest: MyAvatarImageCropRequest | null;
    manageTagsAvatar: MyAvatarRow | null;
    savingTagsAvatarId: string;
    onEditDetailsOpenChange: (open: boolean) => void;
    onContentTagsOpenChange: (open: boolean) => void;
    onImageCropOpenChange: (open: boolean) => void;
    onImageCropConfirm: (blob: Blob) => void | Promise<void>;
    onManageTagsOpenChange: (open: boolean) => void;
    onSaveTags: (payload: { avatarId: string; tags: MyAvatarTag[] }) => void;
    onEditDetailsSaved: (avatar: MyAvatarRow) => void;
    onContentTagsSaved: (avatar: MyAvatarRow) => void;
};

export function MyAvatarsDialogs({
    editDetailsAvatar,
    contentTagsAvatar,
    imageCropRequest,
    manageTagsAvatar,
    savingTagsAvatarId,
    onEditDetailsOpenChange,
    onContentTagsOpenChange,
    onImageCropOpenChange,
    onImageCropConfirm,
    onManageTagsOpenChange,
    onSaveTags,
    onEditDetailsSaved,
    onContentTagsSaved
}: MyAvatarsDialogsProps) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );

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
