import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    EMPTY_ASSETS,
    sanitizeGalleryTab,
    TAB_ORDER,
    type GalleryTab
} from './galleryConstants';
import {
    getGalleryGridDensityConfig,
    sanitizeGalleryGridDensity
} from './galleryDensity';
import { useGalleryActions } from './useGalleryActions';
import { useGalleryRuntimeState } from './useGalleryRuntimeState';

const GALLERY_GRID_DENSITY_STORAGE_KEY = 'VRCX_GalleryGridDensity';

type GalleryAuthTarget = {
    endpoint: string;
    userId: string;
};

type GalleryUploadSettings = {
    animationStyle: string;
    fps: number;
    frames: number;
    isAnimated: boolean;
    loopPingPong: boolean;
};

type GalleryUploadTarget = GalleryTab | 'emojis' | 'stickers';

type GalleryCropRequest = {
    aspectRatio: number;
    authTarget: GalleryAuthTarget;
    file: File;
    settings: GalleryUploadSettings;
    tab: GalleryUploadTarget;
};

function readGalleryGridDensityPreference() {
    if (typeof window === 'undefined') {
        return sanitizeGalleryGridDensity();
    }

    try {
        return sanitizeGalleryGridDensity(
            window.localStorage.getItem(GALLERY_GRID_DENSITY_STORAGE_KEY)
        );
    } catch {
        return sanitizeGalleryGridDensity();
    }
}

function writeGalleryGridDensityPreference(value: any) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(GALLERY_GRID_DENSITY_STORAGE_KEY, value);
    } catch {
        // no-op
    }
}

export function useGalleryPageController() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const uploadTargetRef = useRef<GalleryUploadTarget>('gallery');
    const uploadAuthTargetRef = useRef<GalleryAuthTarget | null>(null);
    const {
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        isVrcPlusSupporter,
        openImagePreview,
        profilePicOverride,
        userIcon
    } = useGalleryRuntimeState();
    const [activeTab, setActiveTabState] = useState(() =>
        sanitizeGalleryTab(searchParams.get('tab'))
    );
    const [assets, setAssets] = useState(EMPTY_ASSETS);
    const [loadingByTab, setLoadingByTab] = useState<Record<string, boolean>>(
        {}
    );
    const [uploadingTab, setUploadingTab] = useState('');
    const [mutatingKey, setMutatingKey] = useState('');
    const [cropRequest, setCropRequest] = useState<GalleryCropRequest | null>(
        null
    );
    const [emojiAnimFps, setEmojiAnimFps] = useState(15);
    const [emojiAnimFrameCount, setEmojiAnimFrameCount] = useState(4);
    const [emojiAnimType, setEmojiAnimType] = useState(false);
    const [emojiAnimationStyle, setEmojiAnimationStyle] = useState('Stop');
    const [emojiAnimLoopPingPong, setEmojiAnimLoopPingPong] = useState(false);
    const [gridDensity, setGridDensity] = useState(() =>
        readGalleryGridDensityPreference()
    );
    const gridDensityConfig = useMemo(
        () => getGalleryGridDensityConfig(gridDensity),
        [gridDensity]
    );
    const tabCounts = useMemo(
        () => ({
            gallery: `${assets.gallery.length}/64`,
            icons: `${assets.icons.length}/64`,
            prints: `${assets.prints.length}/64`
        }),
        [assets.gallery.length, assets.icons.length, assets.prints.length]
    );
    useEffect(() => {
        if (!currentUserId) {
            setAssets(EMPTY_ASSETS);
            setLoadingByTab({});
            return;
        }
        refreshAll();
    }, [currentEndpoint, currentUserId]);

    useEffect(() => {
        const nextTab = sanitizeGalleryTab(searchParams.get('tab'));
        setActiveTabState((current) =>
            current === nextTab ? current : nextTab
        );
    }, [searchParams]);
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
    } = useGalleryActions({
        activeTab,
        cropRequest,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        emojiAnimFps,
        emojiAnimFrameCount,
        emojiAnimLoopPingPong,
        emojiAnimType,
        emojiAnimationStyle,
        isVrcPlusSupporter,
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
        uploadAuthTargetRef,
        uploadInputRef,
        uploadTargetRef
    });
    function changeGridDensity(nextValue: unknown) {
        const nextDensity = sanitizeGalleryGridDensity(nextValue);
        setGridDensity(nextDensity);
        writeGalleryGridDensityPreference(nextDensity);
    }
    function setActiveTab(nextValue: unknown) {
        const nextTab = sanitizeGalleryTab(nextValue);
        setActiveTabState(nextTab);
        setSearchParams(
            (currentParams) => {
                const nextParams = new URLSearchParams(currentParams);
                if (nextTab === TAB_ORDER[0]) {
                    nextParams.delete('tab');
                } else {
                    nextParams.set('tab', nextTab);
                }
                return nextParams;
            },
            { replace: true }
        );
    }
    return {
        uploadInputRef,
        uploadingTab,
        uploadSelectedFile,
        gridDensity,
        changeGridDensity,
        navigate,
        refreshAll,
        setActiveTab,
        beginUpload,
        setProfileField,
        consumeInventoryBundle,
        deleteFileAsset,
        deletePrint,
        setEmojiAnimationStyle,
        setEmojiAnimFps,
        setEmojiAnimFrameCount,
        setEmojiAnimLoopPingPong,
        setEmojiAnimType,
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
        gridDensityConfig,
        isVrcPlusSupporter,
        loadingByTab,
        mutatingKey,
        profilePicOverride,
        tabCounts,
        userIcon,
        cropRequest,
        setCropRequest,
        confirmCroppedUpload,
        openImagePreview,
        uploadAuthTargetRef
    };
}
