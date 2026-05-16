// @ts-nocheck
import {
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold';

export function GalleryPageView({
    GalleryHeader,
    t,
    uploadInputRef,
    uploadingTab,
    uploadSelectedFile,
    gridDensity,
    changeGridDensity,
    navigate,
    refreshAll,
    GalleryTabsSection,
    setActiveTab,
    beginUpload,
    setProfileField,
    deleteFileAsset,
    deletePrint,
    setPrintCropBorder,
    setPrintUploadNote,
    refreshTab,
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
    userIcon,
    GalleryDialogs,
    cropRequest,
    setCropRequest,
    confirmCroppedUpload,
    openImagePreview,
    uploadAuthTargetRef
}) {
    return (
        <PageScaffold className="gallery-page">
            <GalleryHeader
                t={t}
                uploadInputRef={uploadInputRef}
                uploadingTab={uploadingTab}
                onUploadChange={(event) => void uploadSelectedFile(event)}
                gridDensity={gridDensity}
                onGridDensityChange={changeGridDensity}
                onBack={() => navigate('/tools')}
                onRefreshAll={() => void refreshAll()}
            />

            <PageBody>
                <GalleryTabsSection
                    t={t}
                    handlers={{
                        onActiveTabChange: setActiveTab,
                        onBeginUpload: beginUpload,
                        onClearProfileField: (fieldName, fileId) =>
                            void setProfileField(fieldName, fileId),
                        onDeleteFile: (tab, fileId) =>
                            void deleteFileAsset(tab, fileId),
                        onDeletePrint: (printId) => void deletePrint(printId),
                        onPreview: openImagePreview,
                        onPrintCropBorderChange: setPrintCropBorder,
                        onPrintUploadNoteChange: setPrintUploadNote,
                        onRefresh: (tab) => void refreshTab(tab),
                        onSetProfileField: (fieldName, fileId) =>
                            void setProfileField(fieldName, fileId)
                    }}
                    state={{
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
                    }}
                />
            </PageBody>

            <GalleryDialogs
                cropRequest={cropRequest}
                onClearCropRequest={() => setCropRequest(null)}
                onConfirmCrop={(blob) => confirmCroppedUpload(blob)}
                onResetUploadAuthTarget={() => {
                    uploadAuthTargetRef.current = null;
                }}
                t={t}
            />
        </PageScaffold>
    );
}
