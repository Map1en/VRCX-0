import type {
    GalleryBulkCommands,
    GalleryCommands,
    GalleryModel
} from '../galleryTypes';
import { GalleryTabs } from './GalleryTabs';

export function GalleryTabsSection({
    galleryBulkCommands,
    galleryCommands,
    galleryModel
}: {
    galleryBulkCommands: GalleryBulkCommands;
    galleryCommands: GalleryCommands;
    galleryModel: GalleryModel;
}) {
    const {
        activeTab,
        assets,
        clipboardPasting,
        currentUserId,
        gridDensityConfig,
        isVrcPlusSupporter,
        loadingByTab,
        mutatingKey,
        bannerCustomUrl,
        mediaProfileLoading,
        mediaProfileError,
        tabCounts,
        uploadingTab,
        userIcon
    } = galleryModel;
    const {
        onActiveTabChange,
        onBeginUpload,
        onPasteUpload,
        onClearProfileField,
        onDeleteFile,
        onDeletePrint,
        onPreview,
        onRefresh,
        onSetProfileField
    } = galleryCommands;

    return (
        <GalleryTabs
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
            tabCounts={tabCounts}
            fileTab={{
                ...galleryBulkCommands,
                activeTab,
                assets,
                clipboardPasting,
                loadingByTab,
                uploadingTab,
                mutatingKey,
                currentUserId,
                isVrcPlusSupporter,
                bannerCustomUrl,
                mediaProfileLoading,
                mediaProfileError,
                userIcon,
                gridDensityConfig,
                onBeginUpload,
                onPasteUpload,
                onClearProfileField,
                onPreview,
                onSetProfileField,
                onDeleteFile
            }}
            printsTab={{
                ...galleryBulkCommands,
                activeTab,
                prints: assets.prints,
                loading: loadingByTab.prints,
                clipboardPasting,
                uploadingTab,
                mutatingKey,
                isVrcPlusSupporter,
                gridDensityConfig,
                onRefresh,
                onBeginUpload,
                onPasteUpload,
                onPreview,
                onDeletePrint
            }}
        />
    );
}
