// @ts-nocheck
import { GalleryTabs } from './GalleryTabs';

export function GalleryTabsSection({ handlers, state, t }) {
    const {
        activeTab,
        assets,
        currentUserId,
        gridDensityConfig,
        isVrcPlusSupporter,
        loadingByTab,
        mutatingKey,
        printCropBorder,
        printUploadNote,
        profilePicOverride,
        tabCounts,
        uploadingTab,
        userIcon
    } = state;
    const {
        onActiveTabChange,
        onBeginUpload,
        onClearProfileField,
        onDeleteFile,
        onDeletePrint,
        onPreview,
        onPrintCropBorderChange,
        onPrintUploadNoteChange,
        onRefresh,
        onSetProfileField
    } = handlers;

    return (
        <GalleryTabs
            t={t}
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
            tabCounts={tabCounts}
            fileTab={{
                assets,
                loadingByTab,
                uploadingTab,
                mutatingKey,
                isVrcPlusSupporter,
                currentUserId,
                profilePicOverride,
                userIcon,
                gridDensityConfig,
                onRefresh,
                onBeginUpload,
                onClearProfileField,
                onPreview,
                onSetProfileField,
                onDeleteFile
            }}
            printsTab={{
                prints: assets.prints,
                loading: loadingByTab.prints,
                uploadingTab,
                mutatingKey,
                isVrcPlusSupporter,
                gridDensityConfig,
                printUploadNote,
                printCropBorder,
                onRefresh,
                onBeginUpload,
                onPrintUploadNoteChange,
                onPrintCropBorderChange,
                onPreview,
                onDeletePrint
            }}
        />
    );
}
