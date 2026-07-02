import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import mediaRepository from '@/repositories/mediaRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload';

import { normalizeEntityId } from './worldInstances';

export function useWorldImageUpload({
    world,
    canManageWorld,
    currentEndpoint,
    profileWorldId,
    actionStatusRef,
    setActionStatus,
    activeWorldTargetRef,
    setWorld,
    setDetail
}: any) {
    const { t } = useTranslation();
    const [imageCropRequest, setImageCropRequest] = useState<{
        file: any;
        world: any;
    } | null>(null);
    const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
    const imageUploadWorldRef = useRef<unknown>(null);

    useEffect(() => {
        imageUploadWorldRef.current = null;
        setImageCropRequest(null);
    }, [profileWorldId]);

    function beginWorldImageUpload() {
        if (!canManageWorld || actionStatusRef.current !== 'idle') {
            return;
        }
        imageUploadWorldRef.current = world;
        imageUploadInputRef.current?.click();
    }

    function onFileChangeWorldImage(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }
        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            const message =
                validation.reason === 'too_large'
                    ? t('dialog.world.error.selected_image_is_too_large')
                    : t('dialog.world.error.selected_file_is_not_an_image');
            setDetail(message);
            toast.error(message);
            return;
        }
        const selectedWorld = imageUploadWorldRef.current || world;
        if (!selectedWorld?.id) {
            return;
        }
        imageUploadWorldRef.current = selectedWorld;
        setImageCropRequest({
            file,
            world: selectedWorld
        });
    }

    async function confirmWorldImageUpload(blob: Blob | null | undefined) {
        const request = imageCropRequest;
        const selectedWorld =
            request?.world || imageUploadWorldRef.current || world;
        const selectedWorldId = normalizeEntityId(selectedWorld?.id);
        const requestEndpoint = currentEndpoint;
        if (!blob || !selectedWorldId) {
            return;
        }

        actionStatusRef.current = 'image-upload';
        setActionStatus('image-upload');
        try {
            const base64Body = await readFileAsBase64(blob);
            const base64File =
                await mediaRepository.resizeImageToFitLimits(base64Body);
            const result = await withUploadTimeout(
                mediaRepository.uploadWorldImageLegacy({
                    worldId: selectedWorldId,
                    imageUrl:
                        selectedWorld.imageUrl ||
                        selectedWorld.thumbnailImageUrl ||
                        '',
                    base64File,
                    endpoint: requestEndpoint
                })
            );
            const activeTarget = activeWorldTargetRef.current;
            if (
                activeTarget.worldId !== selectedWorldId ||
                activeTarget.endpoint !== requestEndpoint
            ) {
                return;
            }
            setWorld(worldProfileRepository.normalize(result.world));
            setDetail(
                t('dialog.world.dynamic.world_image_updated_for_value', {
                    value: selectedWorld.name || selectedWorldId
                })
            );
            toast.success(t('dialog.world.success.world_image_updated'));
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_upload_world_image');
            setDetail(message);
            toast.error(message);
        } finally {
            imageUploadWorldRef.current = null;
            setImageCropRequest(null);
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        imageCropRequest,
        setImageCropRequest,
        imageUploadInputRef,
        imageUploadWorldRef,
        beginWorldImageUpload,
        onFileChangeWorldImage,
        confirmWorldImageUpload
    };
}
