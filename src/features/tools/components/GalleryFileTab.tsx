import { ClipboardPasteIcon, UploadIcon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolbarOverflowMenu } from '@/components/layout/ToolbarControls';
import { VrcPlusLockedNotice } from '@/components/media/VrcPlusLockedNotice';
import { useTileSelectionState } from '@/lib/useTileSelectionState';
import { isProfileMediaFileUsableWithoutVrcPlus } from '@/shared/utils/currentUserMedia';
import { extractFileId } from '@/shared/utils/fileUtils';
import { Button } from '@/ui/shadcn/button';
import { DropdownMenuGroup, DropdownMenuItem } from '@/ui/shadcn/dropdown-menu';
import { TabsContent } from '@/ui/shadcn/tabs';

import {
    UPLOAD_ASPECT_RATIOS,
    type FileAssetTab,
    type FileTabDefinition
} from '../galleryConstants';
import type { GalleryFileTabState } from '../galleryTypes';
import { useVirtualTileGrid } from '../useVirtualTileGrid';
import { GalleryFileCard } from './GalleryFileCard';
import { GallerySelectionBar } from './GallerySelectionBar';
import { EmptyState, LoadingState } from './GalleryViewParts';
import { MediaLibraryToolbar } from './MediaLibraryToolbar';
import { VirtualTileGridRows } from './VirtualTileGridRows';

function getFileKey(file: { id: string }) {
    return file.id;
}

export function GalleryFileTab({
    tab,
    definition,
    fileTab
}: {
    tab: FileAssetTab;
    definition: FileTabDefinition;
    fileTab: GalleryFileTabState;
}) {
    const {
        activeTab,
        assets,
        bulkRunning,
        loadingByTab,
        clipboardPasting,
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
        onBulkDelete,
        onClearProfileField,
        onPreview,
        onSetProfileField,
        onDeleteFile
    } = fileTab;
    const files = assets[tab];
    const loading = loadingByTab[tab] || mediaProfileLoading;
    const uploadBusy = Boolean(uploadingTab) || clipboardPasting;
    const { t } = useTranslation();
    const activeFileId =
        tab === 'gallery'
            ? extractFileId(bannerCustomUrl)
            : extractFileId(userIcon);
    const fileIds = useMemo(() => files.map((file) => file.id), [files]);
    const isLocked = (file: (typeof files)[number]) =>
        !isVrcPlusSupporter &&
        !isProfileMediaFileUsableWithoutVrcPlus(
            tab === 'gallery' ? 'banner' : 'userIcon',
            file
        );
    const hasLockedFiles = files.some(isLocked);
    const selection = useTileSelectionState({
        keys: fileIds,
        resetToken: activeTab
    });
    const selectedFileIds = useMemo(
        () => fileIds.filter((fileId) => selection.selectedKeysSet.has(fileId)),
        [fileIds, selection.selectedKeysSet]
    );
    const deletableFileIds = useMemo(
        () => selectedFileIds.filter((fileId) => fileId !== activeFileId),
        [activeFileId, selectedFileIds]
    );
    const tileGrid = useVirtualTileGrid({
        items: files,
        minTileWidth: gridDensityConfig.fileTileMinWidth,
        gap: gridDensityConfig.tileGridGap,
        aspectRatio: UPLOAD_ASPECT_RATIOS[tab],
        resetKey: tab
    });

    return (
        <TabsContent
            value={tab}
            className="mt-2 flex min-h-0 flex-1 data-hidden:hidden"
        >
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <MediaLibraryToolbar
                    actions={
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={uploadBusy}
                                onClick={() => onBeginUpload(tab)}
                            >
                                <UploadIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.upload')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={uploadBusy}
                                onClick={() => onPasteUpload(tab)}
                            >
                                <ClipboardPasteIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.paste_upload')}
                            </Button>
                            {tab === 'gallery' ? (
                                <ToolbarOverflowMenu>
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            variant="destructive"
                                            disabled={
                                                !bannerCustomUrl ||
                                                mediaProfileLoading ||
                                                Boolean(mediaProfileError) ||
                                                Boolean(mutatingKey)
                                            }
                                            onClick={() =>
                                                onClearProfileField(
                                                    'banner',
                                                    ''
                                                )
                                            }
                                        >
                                            <XIcon data-icon="inline-start" />
                                            {t(
                                                'dialog.gallery_icons.clear_banner'
                                            )}
                                        </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                </ToolbarOverflowMenu>
                            ) : null}
                            {tab === 'icons' ? (
                                <ToolbarOverflowMenu>
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            variant="destructive"
                                            disabled={
                                                !userIcon ||
                                                mediaProfileLoading ||
                                                Boolean(mediaProfileError) ||
                                                Boolean(mutatingKey)
                                            }
                                            onClick={() =>
                                                onClearProfileField(
                                                    'userIcon',
                                                    ''
                                                )
                                            }
                                        >
                                            <XIcon data-icon="inline-start" />
                                            {t(
                                                'dialog.gallery_icons.clear_profile_icon'
                                            )}
                                        </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                </ToolbarOverflowMenu>
                            ) : null}
                        </>
                    }
                />
                {hasLockedFiles && !loading ? (
                    <VrcPlusLockedNotice className="mb-2" />
                ) : null}
                <div
                    ref={tileGrid.viewportRef}
                    className="min-h-0 flex-1 overflow-y-auto pr-1"
                >
                    {loading ? (
                        <LoadingState />
                    ) : mediaProfileError ? (
                        <EmptyState title={mediaProfileError} />
                    ) : files.length > 0 ? (
                        <VirtualTileGridRows
                            columnCount={tileGrid.columnCount}
                            gap={gridDensityConfig.tileGridGap}
                            getKey={getFileKey}
                            totalHeight={tileGrid.totalHeight}
                            visibleRows={tileGrid.visibleRows}
                            renderItem={(file) => (
                                <GalleryFileCard
                                    tab={tab}
                                    definition={definition}
                                    file={file}
                                    bannerCustomUrl={bannerCustomUrl}
                                    userIcon={userIcon}
                                    locked={isLocked(file)}
                                    mutatingKey={mutatingKey}
                                    currentUserId={currentUserId}
                                    selected={selection.selectedKeysSet.has(
                                        file.id
                                    )}
                                    selectionActive={selection.hasSelection}
                                    onToggleSelect={(checked, shift) =>
                                        selection.selectItem(file.id, checked, {
                                            shift
                                        })
                                    }
                                    onPreview={onPreview}
                                    onSetProfileField={onSetProfileField}
                                    onDeleteFile={onDeleteFile}
                                />
                            )}
                        />
                    ) : (
                        <EmptyState
                            icon={UploadIcon}
                            title={t('empty_state.gallery_images_title')}
                            description={t(
                                'empty_state.gallery_images_description'
                            )}
                        >
                            <Button
                                type="button"
                                variant="link"
                                disabled={uploadBusy}
                                onClick={() => onBeginUpload(tab)}
                            >
                                {t('dialog.gallery_icons.upload')}
                            </Button>
                        </EmptyState>
                    )}
                </div>
                <GallerySelectionBar
                    selectedCount={selectedFileIds.length}
                    deletableCount={deletableFileIds.length}
                    isAllSelected={selection.isAllSelected}
                    actionsDisabled={bulkRunning}
                    onSelectAll={selection.toggleSelectAll}
                    onClearSelection={selection.clearSelection}
                    onDelete={() =>
                        onBulkDelete({
                            tab,
                            assetIds: deletableFileIds,
                            lockedCount:
                                selectedFileIds.length - deletableFileIds.length
                        })
                    }
                />
            </div>
        </TabsContent>
    );
}
