import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { isRuntimeAuthTarget } from './galleryAuthTarget';
import {
    canUploadGalleryTarget,
    EMPTY_ASSETS,
    sanitizeGalleryTab,
    TAB_ORDER,
    type GalleryUploadTarget
} from './galleryConstants';
import {
    getGalleryGridDensityConfig,
    sanitizeGalleryGridDensity,
    type GalleryGridDensity
} from './galleryDensity';
import type {
    GalleryAuthTarget,
    GalleryControllerDeps,
    GalleryCropRequest
} from './galleryTypes';
import { useGalleryActions } from './useGalleryActions';
import { useGalleryBulkActions } from './useGalleryBulkActions';
import { useGalleryRuntimeState } from './useGalleryRuntimeState';
import { useImageUploadIntake } from './useImageUploadIntake';

const GALLERY_GRID_DENSITY_STORAGE_KEY = 'VRCX_0_GalleryGridDensity';

function readGalleryGridDensityPreference() {
    return sanitizeGalleryGridDensity(
        localStorage.getItem(GALLERY_GRID_DENSITY_STORAGE_KEY)
    );
}

function writeGalleryGridDensityPreference(value: GalleryGridDensity) {
    localStorage.setItem(GALLERY_GRID_DENSITY_STORAGE_KEY, value);
}

export function useGalleryPageController() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const {
        currentEndpoint,
        currentUserId,
        isVrcPlusSupporter,
        openImagePreview,
        bannerCustomUrl,
        mediaProfile,
        mediaProfileLoading,
        mediaProfileError,
        refreshMediaProfile,
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
    const {
        refreshTab,
        refreshAll: refreshAllAssets,
        getAuthTarget,
        openCropRequest,
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
        mediaProfile,
        refreshMediaProfile,
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
        setUploadingTab
    } satisfies GalleryControllerDeps);
    const { bulkRunning, deleteSelection, setFavoriteSelection } =
        useGalleryBulkActions({ setAssets });
    const {
        beginUpload,
        clipboardPasting,
        fileDropActive,
        pasteClipboardUpload,
        pasteScopeRef,
        uploadInputRef,
        uploadSelectedFile
    } = useImageUploadIntake<GalleryUploadTarget, GalleryAuthTarget>({
        enabled: Boolean(currentUserId) && !cropRequest && !uploadingTab,
        activeTarget: activeTab,
        canUploadTo: (tab) => canUploadGalleryTarget(tab, isVrcPlusSupporter),
        getAuthTarget,
        isCurrentAuthTarget: isRuntimeAuthTarget,
        openCropRequest
    });
    const refreshAllRef = useRef(refreshAllAssets);
    useEffect(() => {
        refreshAllRef.current = refreshAllAssets;
    }, [refreshAllAssets]);

    useEffect(() => {
        setAssets(EMPTY_ASSETS);
        setLoadingByTab({});
        if (!currentUserId) {
            return;
        }
        refreshAllRef.current();
    }, [currentEndpoint, currentUserId]);

    useEffect(() => {
        const nextTab = sanitizeGalleryTab(searchParams.get('tab'));
        setActiveTabState((current) =>
            current === nextTab ? current : nextTab
        );
    }, [searchParams]);

    function changeGridDensity(nextValue: GalleryGridDensity) {
        setGridDensity(nextValue);
        writeGalleryGridDensityPreference(nextValue);
    }
    function setActiveTab(nextValue: string) {
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
        bulkRunning,
        deleteSelection,
        setFavoriteSelection,
        uploadInputRef,
        uploadingTab,
        uploadSelectedFile,
        fileDropActive,
        pasteScopeRef,
        gridDensity,
        changeGridDensity,
        navigate,
        refreshAll: () => {
            refreshAllAssets();
            void refreshMediaProfile().catch(() => {});
        },
        setActiveTab,
        beginUpload,
        pasteClipboardUpload,
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
        clipboardPasting,
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
        bannerCustomUrl,
        mediaProfileLoading,
        mediaProfileError,
        tabCounts,
        userIcon,
        cropRequest,
        setCropRequest,
        confirmCroppedUpload,
        openImagePreview
    };
}
