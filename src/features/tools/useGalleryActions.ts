import { useTranslation } from 'react-i18next';

import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { toast } from '@/services/toastService';
import {
    readFileAsBase64,
    withUploadTimeout
} from '@/shared/utils/imageUpload';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { isRuntimeAuthTarget } from './galleryAuthTarget';
import { FILE_TABS, UPLOAD_ASPECT_RATIOS } from './galleryConstants';
import type { GalleryActionDeps, GalleryControllerDeps } from './galleryTypes';
import { parseEmojiUploadSettings } from './inventoryHelpers';
import { createGalleryAssetActions } from './useGalleryAssetActions';
import { useGalleryInventoryActions } from './useGalleryInventoryActions';

function getLocalTimestampString() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 19);
}

export function useGalleryActions(deps: GalleryControllerDeps) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const actionDeps = {
        ...deps,
        FILE_TABS,
        UPLOAD_ASPECT_RATIOS,
        confirm,
        getLocalTimestampString,
        isRuntimeAuthTarget,
        mediaRepository: vrchatMediaRepository,
        parseEmojiUploadSettings,
        prompt,
        readFileAsBase64,
        t,
        toast,
        useRuntimeStore,
        userProfileRepository,
        withUploadTimeout
    } satisfies GalleryActionDeps;
    const assetActions = createGalleryAssetActions(actionDeps);
    const inventoryActions = useGalleryInventoryActions({
        ...actionDeps,
        ...assetActions
    });
    return {
        ...assetActions,
        ...inventoryActions
    };
}
