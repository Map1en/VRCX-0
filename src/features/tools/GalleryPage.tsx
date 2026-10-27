import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { FileDropOverlay } from '@/components/file-drop/FileDropOverlay';
import { PageBody, PageScaffold } from '@/components/layout/PageScaffold';

import { GalleryDialogs } from './components/GalleryDialogs';
import { GalleryHeader } from './components/GalleryHeader';
import { GalleryTabsSection } from './components/GalleryTabsSection';
import type { FileAssetTab, GalleryTab } from './galleryConstants';
import type { GalleryProfileField, GalleryUploadOptions } from './galleryTypes';
import { useGalleryPageController } from './useGalleryPageController';

export function GalleryPage() {
    const { t } = useTranslation();
    const pageState = useGalleryPageController();

    return (
        <PageScaffold ref={pageState.imagePasteRef} className="gallery-page">
            <GalleryHeader
                uploadInputRef={pageState.uploadInputRef}
                uploadingTab={pageState.uploadingTab}
                onUploadChange={(event: ChangeEvent<HTMLInputElement>) => {
                    pageState.uploadSelectedFile(event);
                }}
                gridDensity={pageState.gridDensity}
                onGridDensityChange={pageState.changeGridDensity}
                onRefreshAll={() => {
                    pageState.refreshAll();
                }}
            />

            <PageBody>
                <GalleryTabsSection
                    galleryBulkCommands={{
                        bulkRunning: pageState.bulkRunning,
                        onBulkDelete: (input) => {
                            pageState.deleteSelection(input);
                        },
                        onBulkSetFavorite: (input) => {
                            pageState.setFavoriteSelection(input);
                        }
                    }}
                    galleryModel={{
                        activeTab: pageState.activeTab,
                        assets: pageState.assets,
                        clipboardPasting: pageState.clipboardPasting,
                        currentUserId: pageState.currentUserId,
                        gridDensityConfig: pageState.gridDensityConfig,
                        isVrcPlusSupporter: pageState.isVrcPlusSupporter,
                        loadingByTab: pageState.loadingByTab,
                        mutatingKey: pageState.mutatingKey,
                        bannerCustomUrl: pageState.bannerCustomUrl,
                        mediaProfileLoading: pageState.mediaProfileLoading,
                        mediaProfileError: pageState.mediaProfileError,
                        tabCounts: pageState.tabCounts,
                        uploadingTab: pageState.uploadingTab,
                        userIcon: pageState.userIcon
                    }}
                    galleryCommands={{
                        onActiveTabChange: pageState.setActiveTab,
                        onBeginUpload: pageState.beginUpload,
                        onPasteUpload: (tab: GalleryTab) => {
                            void pageState.pasteClipboardUpload(tab);
                        },
                        onClearProfileField: (
                            fieldName: GalleryProfileField,
                            fileId: string
                        ) => {
                            pageState.setProfileField(fieldName, fileId);
                        },
                        onDeleteFile: (tab: FileAssetTab, fileId: string) => {
                            pageState.deleteFileAsset(tab, fileId);
                        },
                        onDeletePrint: (printId: string) => {
                            pageState.deletePrint(printId);
                        },
                        onPreview: pageState.openImagePreview,
                        onRefresh: (tab: GalleryTab) => {
                            pageState.refreshTab(tab);
                        },
                        onSetProfileField: (
                            fieldName: GalleryProfileField,
                            fileId: string
                        ) => {
                            pageState.setProfileField(fieldName, fileId);
                        }
                    }}
                />
            </PageBody>

            <GalleryDialogs
                cropRequest={pageState.cropRequest}
                onClearCropRequest={() => pageState.setCropRequest(null)}
                onConfirmCrop={(
                    blob: Blob,
                    uploadOptions: GalleryUploadOptions = {}
                ) => pageState.confirmCroppedUpload(blob, uploadOptions)}
                onResetUploadAuthTarget={() => {
                    pageState.uploadAuthTargetRef.current = null;
                }}
            />

            <FileDropOverlay
                active={pageState.fileDropActive}
                label={t('view.tools.file_drop.upload_to', {
                    target: t(`dialog.gallery_icons.${pageState.activeTab}`)
                })}
            />
        </PageScaffold>
    );
}
