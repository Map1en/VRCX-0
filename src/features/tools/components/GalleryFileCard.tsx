import { CheckIcon, EyeIcon, ImageIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { extractFileId } from '@/shared/utils/fileUtils';

import { GalleryEmojiImage } from './GalleryEmojiImage';
import { MediaAssetTile } from './MediaAssetTile';

function getLatestFileUrl(file: any) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    return versions.at(-1)?.file?.url ?? '';
}

function getUsefulDisplayName(file: any) {
    const displayName = String(file?.displayName || '').trim();
    const name = String(file?.name || '').trim();
    const id = String(file?.id || '').trim();
    const visibleName = displayName || name;

    if (
        !visibleName ||
        visibleName === id ||
        /^file_[\w-]+_blob$/i.test(visibleName)
    ) {
        return '';
    }

    return visibleName;
}

export function GalleryFileCard({
    tab,
    definition,
    file,
    profilePicOverride,
    userIcon,
    mutatingKey,
    isVrcPlusSupporter,
    currentUserId,
    onPreview,
    onSetProfileField,
    onDeleteFile
}: any) {
    const { t } = useTranslation();

    const imageUrl = getLatestFileUrl(file);
    const displayName = getUsefulDisplayName(file);
    const activeFileId =
        tab === 'gallery'
            ? extractFileId(profilePicOverride)
            : extractFileId(userIcon);
    // VRChat's web UI calls profilePicOverride the Banner; keep the API field unchanged.
    const profileField =
        tab === 'gallery'
            ? 'profilePicOverride'
            : tab === 'icons'
              ? 'userIcon'
              : '';
    const isCurrent = activeFileId === file.id;
    const isFileMutating = mutatingKey === `${tab}:${file.id}`;
    const isProfileMutating = profileField
        ? mutatingKey === `${profileField}:${file.id}` ||
          mutatingKey === `${profileField}:clear`
        : false;
    const isMutating = isFileMutating || isProfileMutating;
    const badges =
        tab === 'emojis'
            ? [
                  file.loopStyle
                      ? { key: 'loopStyle', label: file.loopStyle }
                      : null,
                  file.animationStyle
                      ? { key: 'animationStyle', label: file.animationStyle }
                      : null,
                  file.framesOverTime
                      ? {
                            key: 'fps',
                            label: `${file.framesOverTime}${t('view.tools.label.fps')}`
                        }
                      : null,
                  file.frames
                      ? {
                            key: 'frames',
                            label: `${file.frames}${t('view.tools.label.frames')}`
                        }
                      : null
              ].filter(Boolean)
            : [];
    const primaryAction =
        profileField && !isCurrent
            ? {
                  label:
                      tab === 'icons'
                          ? t('dialog.gallery_icons.use_profile_icon')
                          : t('dialog.gallery_icons.use_banner'),
                  icon: CheckIcon,
                  disabled: !isVrcPlusSupporter || isMutating || !currentUserId,
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
            badges={badges}
            imageUrl={imageUrl}
            alt={file.displayName || file.name || file.id}
            aspectClass={definition.aspectClass}
            imageFit={tab === 'gallery' ? 'cover' : 'contain'}
            isCurrent={isCurrent}
            currentLabel={t('dialog.gallery_icons.current')}
            menuLabel={t('aria.more')}
            placeholderIcon={ImageIcon}
            hideContent
            renderMedia={
                imageUrl
                    ? ({ className }: any) => (
                          <GalleryEmojiImage
                              file={tab === 'emojis' ? file : null}
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
                    label: t('common.actions.delete'),
                    icon: Trash2Icon,
                    destructive: true,
                    disabled: isMutating,
                    onSelect: () => onDeleteFile(tab, file.id)
                }
            ]}
        />
    );
}
