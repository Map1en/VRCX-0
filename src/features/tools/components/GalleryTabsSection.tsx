import { GalleryTabs } from './GalleryTabs';

export function GalleryTabsSection({ galleryCommands, galleryModel }: any) {
    const {
        activeTab,
        assets,
        currentUserId,
        gridDensityConfig,
        isVrcPlusSupporter,
        loadingByTab,
        mutatingKey,
        profilePicOverride,
        tabCounts,
        uploadingTab,
        userIcon
    } = galleryModel;
    const {
        onActiveTabChange,
        onBeginUpload,
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
                onRefresh,
                onBeginUpload,
                onPreview,
                onDeletePrint
            }}
        />
    );
}
