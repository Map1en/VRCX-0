import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import type { AvatarProfileRecord } from '@/domain/entities/profileEntities';
import { IMAGE_UPLOAD_ACCEPT } from '@/shared/utils/imageUpload';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import type {
    AvatarDialogInput,
    AvatarReleaseStatus
} from './avatar-dialog/avatarDialogTypes';
import { useAvatarDialogState } from './avatar-dialog/useAvatarDialogState';
import { AvatarDialogTabbedView } from './AvatarDialogTabbedView';
import {
    AvatarContentTagsDialog,
    AvatarDetailsDialog
} from './AvatarOwnerEditDialogs';

type AvatarDialogEmptyStateProps = {
    title: string;
    description: string;
    loading?: boolean;
};

function AvatarDialogEmptyState({
    title,
    description,
    loading = false
}: AvatarDialogEmptyStateProps) {
    return (
        <AppEmptyState
            className="min-h-56"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

export function AvatarDialogContent({
    avatarId,
    seedData = null
}: AvatarDialogInput) {
    const dialogState = useAvatarDialogState({ avatarId, seedData });

    if (dialogState.status !== 'ready') {
        return <AvatarDialogEmptyState {...dialogState.emptyState} />;
    }

    const {
        applyCurrentAvatarUpdate,
        avatar,
        avatarActions,
        avatarForView,
        currentEndpoint,
        currentUserId,
        imageCropRequest,
        imageUrl,
        labels,
        ownerEditor,
        refs,
        setImageCropRequest,
        setOwnerEditor,
        viewState
    } = dialogState;

    return (
        <>
            <AvatarDialogTabbedView
                avatar={avatarForView}
                avatarView={viewState}
                imageUrl={imageUrl}
                avatarControls={{
                    onRefresh: () => {
                        avatarActions.refreshAvatarProfile();
                    },
                    onSelect: () => {
                        avatarActions.selectAvatar();
                    },
                    onSelectFallback: () => {
                        avatarActions.selectFallbackAvatar();
                    },
                    onReleaseStatus: (nextStatus: AvatarReleaseStatus) => {
                        avatarActions.updateReleaseStatus(nextStatus);
                    },
                    onAvatarBlock: (enabled: boolean) => {
                        avatarActions.setAvatarBlock(enabled);
                    },
                    onSaveMemo: (nextMemo: string) =>
                        avatarActions.saveMemo(nextMemo),
                    onOpenCache: () => {
                        avatarActions.openAvatarCacheFolder();
                    },
                    onDeleteCache: () => {
                        avatarActions.deleteAvatarCache();
                    },
                    onUploadGallery: () =>
                        avatarActions.beginAvatarGalleryUpload(),
                    onEditDetails: () => {
                        avatarActions.editAvatarDetails();
                    },
                    onChangeContentTags: () => {
                        avatarActions.changeAvatarContentTags();
                    },
                    onChangeImage: () => {
                        avatarActions.beginAvatarImageUpload();
                    },
                    onCreateImposter: () => {
                        avatarActions.updateAvatarImposter('create');
                    },
                    onDeleteImposter: () => {
                        avatarActions.updateAvatarImposter('delete');
                    },
                    onRegenerateImposter: () => {
                        avatarActions.updateAvatarImposter('regenerate');
                    },
                    onDelete: () => {
                        avatarActions.deleteAvatar();
                    }
                }}
            />
            <AvatarContentTagsDialog
                open={ownerEditor === 'content-tags'}
                avatar={avatar}
                currentUserId={currentUserId}
                endpoint={currentEndpoint}
                onOpenChange={(open: boolean) =>
                    setOwnerEditor(open ? 'content-tags' : null)
                }
                onSavedCurrentAvatar={(nextAvatar: AvatarProfileRecord) =>
                    applyCurrentAvatarUpdate(nextAvatar)
                }
            />
            <AvatarDetailsDialog
                open={ownerEditor === 'details'}
                avatar={avatar}
                endpoint={currentEndpoint}
                onOpenChange={(open) => setOwnerEditor(open ? 'details' : null)}
                onSavedCurrentAvatar={(nextAvatar) =>
                    applyCurrentAvatarUpdate(nextAvatar)
                }
            />
            <Input
                ref={refs.imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={avatarActions.onFileChangeAvatarImage}
            />
            <Input
                ref={refs.galleryUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={avatarActions.onFileChangeAvatarGallery}
            />
            <ImageCropDialog
                open={Boolean(imageCropRequest)}
                file={imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title={labels.cropTitle}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setImageCropRequest(null);
                        refs.imageUploadAvatarRef.current = null;
                    }
                }}
                onConfirm={(blob: Blob) =>
                    avatarActions.confirmAvatarImageUpload(blob)
                }
            />
        </>
    );
}
