import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { openExternalLink } from '@/lib/entityMedia.js';
import { mediaRepository, vrchatAuthRepository } from '@/repositories/index.js';
import userProfileRepository from '@/repositories/userProfileRepository.js';
import { emojiAnimationStyleList } from '@/shared/constants/emoji.js';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { GalleryDialogs } from './components/GalleryDialogs.jsx';
import { GalleryHeader } from './components/GalleryHeader.jsx';
import { GalleryTabsSection } from './components/GalleryTabsSection.jsx';
import {
    EMPTY_ASSETS,
    FILE_TABS,
    UPLOAD_ASPECT_RATIOS
} from './galleryConstants.js';
import { useGalleryPageActions } from './useGalleryPageActions.js';
const MAX_IMAGE_UPLOAD_BYTES = 20_000_000;
function buildProfilePicOverride(endpoint, fileId) {
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
function isRuntimeAuthTarget(authTarget) {
    const runtimeAuth = getRuntimeAuthTarget();
    return (
        runtimeAuth.userId === authTarget.userId &&
        runtimeAuth.endpoint === authTarget.endpoint
    );
}
function resolveEmojiStyleName(rawValue) {
    const normalizedValue = String(rawValue || '').toLowerCase();
    const match = Object.keys(emojiAnimationStyleList).find(
        (styleName) => styleName.toLowerCase() === normalizedValue
    );
    return match || 'Stop';
}
function parseEmojiUploadSettings(fileName, currentSettings = {}) {
    const next = {
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
function validateImageFile(file, t) {
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
export function useGalleryPageController() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const uploadInputRef = useRef(null);
    const uploadTargetRef = useRef('gallery');
    const uploadAuthTargetRef = useRef(null);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const [activeTab, setActiveTab] = useState('gallery');
    const [assets, setAssets] = useState(EMPTY_ASSETS);
    const [loadingByTab, setLoadingByTab] = useState({});
    const [uploadingTab, setUploadingTab] = useState('');
    const [mutatingKey, setMutatingKey] = useState('');
    const [preview, setPreview] = useState(null);
    const [cropRequest, setCropRequest] = useState(null);
    const [printUploadNote, setPrintUploadNote] = useState('');
    const [printCropBorder, setPrintCropBorder] = useState(true);
    const [emojiAnimFps, setEmojiAnimFps] = useState(15);
    const [emojiAnimFrameCount, setEmojiAnimFrameCount] = useState(4);
    const [emojiAnimType, setEmojiAnimType] = useState(false);
    const [emojiAnimationStyle, setEmojiAnimationStyle] = useState('Stop');
    const [emojiAnimLoopPingPong, setEmojiAnimLoopPingPong] = useState(false);
    const [galleryLimits, setGalleryLimits] = useState({
        maxUserEmoji: null,
        maxUserStickers: null
    });
    const profilePicOverride = currentUserSnapshot?.profilePicOverride || '';
    const userIcon = currentUserSnapshot?.userIcon || '';
    const isVrcPlusSupporter = Boolean(
        currentUserSnapshot?.$isVRCPlus ||
        currentUserSnapshot?.tags?.includes?.('system_supporter') ||
        globalThis?.$debug?.debugVrcPlus
    );
    const tabCounts = useMemo(
        () => ({
            gallery: `${assets.gallery.length}/64`,
            icons: `${assets.icons.length}/64`,
            emojis: `${assets.emojis.length}/${galleryLimits.maxUserEmoji ?? '-'}`,
            stickers: `${assets.stickers.length}/${galleryLimits.maxUserStickers ?? '-'}`,
            prints: `${assets.prints.length}/64`,
            inventory: String(assets.inventory.length)
        }),
        [assets, galleryLimits.maxUserEmoji, galleryLimits.maxUserStickers]
    );
    useEffect(() => {
        if (!currentUserId) {
            setAssets(EMPTY_ASSETS);
            setLoadingByTab({});
            setGalleryLimits({
                maxUserEmoji: null,
                maxUserStickers: null
            });
            return;
        }
        void refreshAll();
    }, [currentEndpoint, currentUserId]);
    useEffect(() => {
        if (!currentUserId) {
            return undefined;
        }
        let active = true;
        vrchatAuthRepository
            .getConfig({
                endpoint: currentEndpoint || ''
            })
            .then((response) => {
                if (!active) {
                    return;
                }
                const config =
                    response?.json && typeof response.json === 'object'
                        ? response.json
                        : {};
                setGalleryLimits({
                    maxUserEmoji: Number.isFinite(Number(config.maxUserEmoji))
                        ? Number(config.maxUserEmoji)
                        : null,
                    maxUserStickers: Number.isFinite(
                        Number(config.maxUserStickers)
                    )
                        ? Number(config.maxUserStickers)
                        : null
                });
            })
            .catch(() => {
                if (active) {
                    setGalleryLimits({
                        maxUserEmoji: null,
                        maxUserStickers: null
                    });
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId]);
    const {
        refreshTab,
        refreshAll,
        beginUpload,
        uploadSelectedFile,
        confirmCroppedUpload,
        deleteFileAsset,
        deletePrint,
        setProfileField,
        consumeInventoryBundle,
        redeemReward
    } = useGalleryPageActions({
        FILE_TABS,
        UPLOAD_ASPECT_RATIOS,
        activeTab,
        buildProfilePicOverride,
        confirm,
        cropRequest,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        emojiAnimFps,
        emojiAnimFrameCount,
        emojiAnimLoopPingPong,
        emojiAnimType,
        emojiAnimationStyle,
        getLocalTimestampString,
        isRuntimeAuthTarget,
        isVrcPlusSupporter,
        mediaRepository,
        parseEmojiUploadSettings,
        printCropBorder,
        printUploadNote,
        prompt,
        readFileAsBase64,
        setAssets,
        setCropRequest,
        setEmojiAnimFps,
        setEmojiAnimFrameCount,
        setEmojiAnimLoopPingPong,
        setEmojiAnimType,
        setEmojiAnimationStyle,
        setLoadingByTab,
        setMutatingKey,
        setUploadingTab,
        t,
        toast,
        uploadAuthTargetRef,
        uploadInputRef,
        uploadTargetRef,
        useRuntimeStore,
        userProfileRepository,
        validateImageFile,
        withUploadTimeout
    });
    return {
        GalleryHeader,
        t,
        uploadInputRef,
        uploadingTab,
        uploadSelectedFile,
        navigate,
        refreshAll,
        GalleryTabsSection,
        setActiveTab,
        beginUpload,
        setProfileField,
        consumeInventoryBundle,
        openExternalLink,
        deleteFileAsset,
        deletePrint,
        setEmojiAnimationStyle,
        setEmojiAnimFps,
        setEmojiAnimFrameCount,
        setEmojiAnimLoopPingPong,
        setEmojiAnimType,
        setPreview,
        setPrintCropBorder,
        setPrintUploadNote,
        redeemReward,
        refreshTab,
        activeTab,
        assets,
        currentUserId,
        emojiAnimFps,
        emojiAnimFrameCount,
        emojiAnimLoopPingPong,
        emojiAnimationStyle,
        emojiAnimType,
        galleryLimits,
        isVrcPlusSupporter,
        loadingByTab,
        mutatingKey,
        preview,
        printCropBorder,
        printUploadNote,
        profilePicOverride,
        tabCounts,
        userIcon,
        GalleryDialogs,
        cropRequest,
        setCropRequest,
        confirmCroppedUpload,
        uploadAuthTargetRef
    };
}
