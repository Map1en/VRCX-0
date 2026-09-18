import { CheckIcon, EyeIcon, ImageIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MediaFileRecord } from '@/repositories/mediaRepository';
import { extractFileId } from '@/shared/utils/fileUtils';

import type { FileAssetTab, FileTabDefinition } from '../galleryConstants';
import type { GalleryProfileField } from '../galleryTypes';
import { getLatestFileUrl, getUsefulDisplayName } from '../inventoryHelpers';
import { GalleryEmojiImage } from './GalleryEmojiImage';
import { MediaAssetTile } from './MediaAssetTile';
import type { MediaPreviewOptions } from './MediaAssetTile';

export function GalleryFileCard({
    tab,
    definition,
    file,
    bannerCustomUrl,
    userIcon,
    mutatingKey,
    currentUserId,
    selected,
    selectionActive,
    onPreview,
    onSetProfileField,
    onDeleteFile,
    onToggleSelect
}: {
    tab: FileAssetTab;
    definition: FileTabDefinition;
    file: MediaFileRecord;
    bannerCustomUrl: string;
    userIcon: string;
    mutatingKey: string;
    currentUserId: string | null;
    selected: boolean;
    selectionActive: boolean;
    onPreview: (options: MediaPreviewOptions) => void;
    onSetProfileField: (fieldName: GalleryProfileField, fileId: string) => void;
    onDeleteFile: (tab: FileAssetTab, fileId: string) => void;
    onToggleSelect: (checked: boolean, shift: boolean) => void;
}) {
    const { t } = useTranslation();

    const imageUrl = getLatestFileUrl(file);
    const displayName = getUsefulDisplayName(file);
    const activeFileId =
        tab === 'gallery'
            ? extractFileId(bannerCustomUrl)
            : extractFileId(userIcon);
    const profileField: GalleryProfileField =
        tab === 'gallery' ? 'banner' : 'userIcon';
    const isCurrent = activeFileId === file.id;
    const isFileMutating = mutatingKey === `${tab}:${file.id}`;
    const isProfileMutating = profileField
        ? mutatingKey === `${profileField}:${file.id}` ||
          mutatingKey === `${profileField}:clear`
        : false;
    const isMutating = isFileMutating || isProfileMutating;
    const primaryAction =
        profileField && !isCurrent
            ? {
                  label:
                      tab === 'icons'
                          ? t('dialog.gallery_icons.use_profile_icon')
                          : t('dialog.gallery_icons.use_banner'),
                  icon: CheckIcon,
                  disabled: isMutating || !currentUserId,
                  onClick: () => onSetProfileField(profileField, file.id)
              }
            : null;
    const canUseProfileMedia = primaryAction && !primaryAction.disabled;
    const previewAction = () =>
        onPreview({
            id: file.id,
            title: displayName || t(definition.titleKey),
            url: imageUrl
        });

    return (
        <MediaAssetTile
            imageUrl={imageUrl}
            alt={file.displayName || file.name || file.id}
            aspectClass={definition.aspectClass}
            imageFit={tab === 'gallery' ? 'cover' : 'contain'}
            isCurrent={isCurrent}
            currentLabel={t('dialog.gallery_icons.current')}
            menuLabel={t('aria.more')}
            placeholderIcon={ImageIcon}
            hideContent
            selectable
            selected={selected}
            selectionActive={selectionActive}
            selectLabel={`${t('common.actions.select')} ${displayName || file.id}`}
            onToggleSelect={onToggleSelect}
            renderMedia={
                imageUrl
                    ? ({ className }: { className: string }) => (
                          <GalleryEmojiImage
                              file={null}
                              imageUrl={imageUrl}
                              alt={file.displayName || file.name || file.id}
                              className={className}
                          />
                      )
                    : null
            }
            onPreview={previewAction}
            onMediaClick={
                canUseProfileMedia ? primaryAction.onClick : previewAction
            }
            mediaHoverLabel={canUseProfileMedia ? primaryAction.label : ''}
            menuActions={[
                imageUrl
                    ? {
                          key: 'preview',
                          label: t('common.actions.open'),
                          icon: EyeIcon,
                          onSelect: previewAction
                      }
                    : null,
                primaryAction && !canUseProfileMedia
                    ? {
                          key: 'use-profile-media',
                          label: primaryAction.label,
                          icon: CheckIcon,
                          disabled: primaryAction.disabled,
                          onSelect: primaryAction.onClick
                      }
                    : null,
                {
                    key: 'delete',
                    label: isCurrent
                        ? t('view.tools.gallery_selection.delete_locked_in_use')
                        : t('common.actions.delete'),
                    icon: Trash2Icon,
                    destructive: true,
                    disabled: isMutating || isCurrent,
                    onSelect: () => onDeleteFile(tab, file.id)
                }
            ]}
        />
    );
}
