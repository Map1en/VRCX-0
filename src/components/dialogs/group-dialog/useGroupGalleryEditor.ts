import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    GroupGalleryPhotoRow,
    GroupGallerySummary
} from '@/domain/entities/group';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';

export type GroupGalleryForm = {
    galleryId: string;
    name: string;
    description: string;
    membersOnly: boolean;
};

export function useGroupGalleryEditor({
    groupId,
    onGalleriesChanged,
    onImagesChanged
}: {
    groupId: string;
    onGalleriesChanged: () => void;
    onImagesChanged: () => void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const [form, setForm] = useState<GroupGalleryForm | null>(null);
    const [imageGallery, setImageGallery] =
        useState<GroupGallerySummary | null>(null);
    const [imageFileId, setImageFileId] = useState('');
    const [saving, setSaving] = useState(false);
    const groupPath = `groups/${encodeURIComponent(groupId)}/galleries`;

    useEffect(() => {
        setForm(null);
        setImageGallery(null);
    }, [groupId]);

    async function run(failureKey: string, action: () => Promise<string>) {
        setSaving(true);
        try {
            toast.add({ type: 'success', title: t(await action()) });
            return true;
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(error, t(failureKey))
            });
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function confirmDelete(title: string, description: string) {
        const result = await confirm({
            title,
            description,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        return result.ok;
    }

    async function submit(next: GroupGalleryForm) {
        if (!groupId || saving) {
            return;
        }
        const params = {
            name: next.name.trim(),
            description: next.description.trim(),
            membersOnly: next.membersOnly
        };
        const saved = await run(
            'dialog.group.gallery.save_failed',
            async () => {
                if (next.galleryId) {
                    unwrapVrchatResponse(
                        await commands.appVrchatGroupGalleryEdit({
                            groupId,
                            galleryId: next.galleryId,
                            params
                        }),
                        `${groupPath}/${encodeURIComponent(next.galleryId)}`
                    );
                    return 'dialog.group.gallery.saved';
                }
                unwrapVrchatResponse(
                    await commands.appVrchatGroupGalleryCreate({
                        groupId,
                        params
                    }),
                    groupPath
                );
                return 'dialog.group.gallery.created';
            }
        );
        if (saved) {
            setForm(null);
            onGalleriesChanged();
        }
    }

    async function removeGallery(gallery: GroupGallerySummary) {
        if (
            !groupId ||
            saving ||
            !(await confirmDelete(
                t('dialog.group.gallery.delete_confirm'),
                t('dialog.group.gallery.delete_confirm_description', {
                    name: gallery.name || gallery.id
                })
            ))
        ) {
            return;
        }
        const deleted = await run(
            'dialog.group.gallery.delete_failed',
            async () => {
                unwrapVrchatResponse(
                    await commands.appVrchatGroupGalleryDelete({
                        groupId,
                        galleryId: gallery.id
                    }),
                    `${groupPath}/${encodeURIComponent(gallery.id)}`
                );
                return 'dialog.group.gallery.deleted';
            }
        );
        if (deleted) {
            onGalleriesChanged();
        }
    }

    async function addImage() {
        const galleryId = imageGallery?.id;
        const fileId = imageFileId.trim();
        if (!groupId || !galleryId || !fileId || saving) {
            return;
        }
        const added = await run(
            'dialog.group.gallery.save_failed',
            async () => {
                const response = unwrapVrchatResponse<{ approved?: boolean }>(
                    await commands.appVrchatGroupGalleryImageAdd({
                        groupId,
                        galleryId,
                        fileId
                    }),
                    `${groupPath}/${encodeURIComponent(galleryId)}/images`
                );
                return response.json?.approved === false
                    ? 'dialog.group.gallery.image_pending_approval'
                    : 'dialog.group.gallery.image_added';
            }
        );
        if (added) {
            setImageGallery(null);
            onImagesChanged();
        }
    }

    async function removeImage(row: GroupGalleryPhotoRow) {
        const galleryId = row.galleryId || row.$galleryId;
        if (
            !groupId ||
            !galleryId ||
            !row.id ||
            saving ||
            !(await confirmDelete(
                t('dialog.group.gallery.delete_image_confirm'),
                ''
            ))
        ) {
            return;
        }
        const imageId = row.id;
        const deleted = await run(
            'dialog.group.gallery.delete_failed',
            async () => {
                unwrapVrchatResponse(
                    await commands.appVrchatGroupGalleryImageDelete({
                        groupId,
                        galleryId,
                        imageId
                    }),
                    `${groupPath}/${encodeURIComponent(galleryId)}/images/${encodeURIComponent(imageId)}`
                );
                return 'dialog.group.gallery.image_deleted';
            }
        );
        if (deleted) {
            onImagesChanged();
        }
    }

    return {
        addImage,
        closeForm: () => {
            if (!saving) {
                setForm(null);
            }
        },
        closeImage: () => {
            if (!saving) {
                setImageGallery(null);
            }
        },
        form,
        imageFileId,
        imageGallery,
        openAddImage: (gallery: GroupGallerySummary) => {
            setImageFileId('');
            setImageGallery(gallery);
        },
        openCreate: () =>
            setForm({
                galleryId: '',
                name: '',
                description: '',
                membersOnly: false
            }),
        openEdit: (gallery: GroupGallerySummary) =>
            setForm({
                galleryId: gallery.id,
                name: gallery.name ?? '',
                description: gallery.description ?? '',
                membersOnly: gallery.membersOnly === true
            }),
        removeGallery,
        removeImage,
        saving,
        setForm,
        setImageFileId,
        submit
    };
}
