import { UploadIcon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ToolbarOverflowMenu } from '@/components/layout/ToolbarControls';
import { useTileSelectionState } from '@/lib/useTileSelectionState';
import { extractFileId } from '@/shared/utils/fileUtils';
import { Button } from '@/ui/shadcn/button';
import { DropdownMenuGroup, DropdownMenuItem } from '@/ui/shadcn/dropdown-menu';
import { TabsContent } from '@/ui/shadcn/tabs';

import type { FileAssetTab, FileTabDefinition } from '../galleryConstants';
import type { GalleryFileTabState } from '../galleryTypes';
import { GalleryFileCard } from './GalleryFileCard';
import { GallerySelectionBar } from './GallerySelectionBar';
import { EmptyState, LoadingState } from './GalleryViewParts';
import { MediaLibraryToolbar } from './MediaLibraryToolbar';

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
        uploadingTab,
        mutatingKey,
        currentUserId,
        profilePicOverride,
        userIcon,
        gridDensityConfig,
        onBeginUpload,
        onBulkDelete,
        onClearProfileField,
        onPreview,
        onSetProfileField,
        onDeleteFile
    } = fileTab;
    const files = assets[tab];
    const loading = loadingByTab[tab];
    const { t } = useTranslation();
    const activeFileId =
        tab === 'gallery'
            ? extractFileId(profilePicOverride)
            : extractFileId(userIcon);
    const fileIds = useMemo(() => files.map((file) => file.id), [files]);
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
                                disabled={Boolean(uploadingTab)}
                                onClick={() => onBeginUpload(tab)}
                            >
                                <UploadIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.upload')}
                            </Button>
                            {tab === 'gallery' ? (
                                <ToolbarOverflowMenu>
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            variant="destructive"
                                            disabled={
                                                !profilePicOverride ||
                                                Boolean(mutatingKey)
                                            }
                                            onClick={() =>
                                                onClearProfileField(
                                                    'profilePicOverride',
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
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {loading ? (
                        <LoadingState />
                    ) : files.length > 0 ? (
                        <div
                            className={`${gridDensityConfig.fileGridClass} p-1`}
                        >
                            {files.map((file) => (
                                <GalleryFileCard
                                    key={file.id}
                                    tab={tab}
                                    definition={definition}
                                    file={file}
                                    profilePicOverride={profilePicOverride}
                                    userIcon={userIcon}
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
                            ))}
                        </div>
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
                                disabled={Boolean(uploadingTab)}
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
