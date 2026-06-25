import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import mediaRepository from '@/repositories/mediaRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import { emojiAnimationStyleList } from '@/shared/constants/emoji';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { FILE_TABS, UPLOAD_ASPECT_RATIOS } from './galleryConstants';
import { useGalleryAssetActions } from './useGalleryAssetActions';
import { useGalleryInventoryActions } from './useGalleryInventoryActions';

const MAX_IMAGE_UPLOAD_BYTES = 20_000_000;

function buildProfilePicOverride(endpoint: any, fileId: any) {
    if (!fileId) {
        return '';
    }
    const base = normalizeVrchatEndpointDomain(endpoint);
    return `${base}/file/${fileId}/1`;
}

function getLocalTimestampString() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 19);
}

function getRuntimeAuthTarget() {
    const runtimeAuth = useRuntimeStore.getState().auth;
    return {
        userId: runtimeAuth.currentUserId || '',
        endpoint: runtimeAuth.currentUserEndpoint || ''
    };
}

function isRuntimeAuthTarget(authTarget: any) {
    const runtimeAuth = getRuntimeAuthTarget();
    return (
        runtimeAuth.userId === authTarget.userId &&
        runtimeAuth.endpoint === authTarget.endpoint
    );
}

function resolveEmojiStyleName(rawValue: any) {
    const normalizedValue = String(rawValue || '').toLowerCase();
    const match = Object.keys(emojiAnimationStyleList).find(
        (styleName: any) => styleName.toLowerCase() === normalizedValue
    );
    return match || 'Stop';
}

function parseEmojiUploadSettings(fileName: any, currentSettings: any = {}) {
    const next: any = {
        isAnimated: Boolean(currentSettings.isAnimated),
        animationStyle: currentSettings.animationStyle || 'Stop',
        fps: Number(currentSettings.fps) || 15,
        frames: Number(currentSettings.frames) || 4,
        loopPingPong: Boolean(currentSettings.loopPingPong)
    };
    for (const value of String(fileName || '')
        .replace(/\.[^/.]+$/, '')
        .split('_')) {
        if (value.endsWith('animationStyle')) {
            next.isAnimated = false;
            next.animationStyle = resolveEmojiStyleName(
                value.replace('animationStyle', '')
            );
        } else if (value.endsWith('frames')) {
            const frames = Number.parseInt(value.replace('frames', ''), 10);
            if (Number.isFinite(frames)) {
                next.isAnimated = true;
                next.frames = Math.min(64, Math.max(2, frames));
            }
        } else if (value.endsWith('fps')) {
            const fps = Number.parseInt(value.replace('fps', ''), 10);
            if (Number.isFinite(fps)) {
                next.fps = Math.min(64, Math.max(1, fps));
            }
        } else if (value.endsWith('loopStyle')) {
            next.loopPingPong =
                value.replace('loopStyle', '').toLowerCase() === 'pingpong';
        }
    }
    return next;
}

function validateImageFile(file: any, t: any) {
    const validation = validateImageUploadFile(file, {
        maxSize: MAX_IMAGE_UPLOAD_BYTES
    });
    if (!validation.ok) {
        toast.error(
            validation.reason === 'too_large'
                ? t('message.file.too_large')
                : t('message.file.not_image')
        );
        return false;
    }
    return true;
}

export function useGalleryActions(deps: any) {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const prompt = useModalStore((state: any) => state.prompt);
    const actionDeps = {
        ...deps,
        FILE_TABS,
        UPLOAD_ASPECT_RATIOS,
        buildProfilePicOverride,
        confirm,
        getLocalTimestampString,
        isRuntimeAuthTarget,
        mediaRepository,
        parseEmojiUploadSettings,
        prompt,
        readFileAsBase64,
        t,
        toast,
        useRuntimeStore,
        userProfileRepository,
        validateImageFile,
        withUploadTimeout
    };
    const assetActions = useGalleryAssetActions(actionDeps);
    const inventoryActions = useGalleryInventoryActions({
        ...actionDeps,
        ...assetActions
    });
    return {
        ...assetActions,
        ...inventoryActions
    };
}
