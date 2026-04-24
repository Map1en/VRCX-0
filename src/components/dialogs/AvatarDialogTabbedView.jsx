import { ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { getPlatformInfo } from '@/lib/avatarPlatform.js';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/lib/entityMedia.js';
import { openUserDialog } from '@/services/dialogService.js';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils.js';
import { useModalStore } from '@/state/modalStore.js';

import {
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityRawJson
} from './EntityDialogScaffold.jsx';
import { AvatarDialogHeaderActions } from './avatar-dialog/components/AvatarDialogHeaderActions.jsx';
import { AvatarDialogHeaderBadges } from './avatar-dialog/components/AvatarDialogHeaderBadges.jsx';
import { AvatarDialogInfoTab } from './avatar-dialog/components/AvatarDialogInfoTab.jsx';

function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
}

function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

let lastAvatarDialogTab = 'info';

function resolveAvatarDialogTab(tabs, preferred, fallback = 'info') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

export function AvatarDialogTabbedView({
    avatar,
    memo,
    detail,
    imageUrl,
    actionStatus,
    avatarBlocked,
    isCurrentAvatar,
    isFavorite,
    canManageAvatar,
    canSelectAvatar,
    canSelectFallbackAvatar,
    fileAnalysis = {},
    onRefresh,
    onSelect,
    onSelectFallback,
    onReleaseStatus,
    onAvatarBlock,
    onEditMemo: _onEditMemo,
    onSaveMemo,
    onOpenCache,
    onDeleteCache,
    onUploadGallery,
    onRename,
    onChangeDescription,
    onChangeContentTags,
    onChangeStylesAndAuthorTags,
    onChangeImage,
    onCreateImposter,
    onDeleteImposter,
    onRegenerateImposter,
    onDelete
}) {
    const { t } = useTranslation();

    const [activeTab, setActiveTab] = useState(() => lastAvatarDialogTab);
    const [galleryIndex, setGalleryIndex] = useState(0);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const avatarFallbackLabel = t('view.favorite.generated.avatar_fallback');
    const tabs = [
        { value: 'info', label: t('dialog.avatar.info.header') },
        { value: 'json', label: t('dialog.avatar.json.header') }
    ];

    function changeTab(tab) {
        lastAvatarDialogTab = resolveAvatarDialogTab(tabs, tab);
        setActiveTab(lastAvatarDialogTab);
    }

    const avatarUrl = avatar.id ? `https://vrchat.com/home/avatar/${avatar.id}` : '';
    const packageUrl = replaceVrcPackageUrl(
        avatar.unityPackageUrl || avatar.unityPackage?.url || ''
    );
    const galleryImages = firstArray(
        avatar.galleryImages,
        avatar.galleries,
        avatar.gallery
    );
    const listings = firstArray(avatar.publishedListings, avatar.listings);
    const currentGalleryEntry = galleryImages[galleryIndex] || null;
    const currentGalleryRawImage =
        currentGalleryEntry?.imageUrl ||
        currentGalleryEntry?.thumbnailImageUrl ||
        currentGalleryEntry?.fileUrl ||
        currentGalleryEntry ||
        '';
    const currentGalleryImage = currentGalleryRawImage
        ? convertFileUrlToImageUrl(currentGalleryRawImage, 1024)
        : '';
    const platformInfo = getPlatformInfo(avatar.unityPackages);
    const localTags = Array.isArray(avatar.$tags) ? avatar.$tags : [];
    const remoteTags = Array.isArray(avatar.tags) ? avatar.tags : [];
    const contentTags = remoteTags.filter((tag) => tag.startsWith('content_'));
    const authorTags = remoteTags.filter((tag) =>
        tag.startsWith('author_tag_')
    );
    const otherTags = remoteTags.filter(
        (tag) => !tag.startsWith('content_') && !tag.startsWith('author_tag_')
    );
    const imposterPackage = Array.isArray(avatar.unityPackages)
        ? avatar.unityPackages.find(
              (unityPackage) => unityPackage?.variant === 'impostor'
          )
        : null;
    const hasImposter = Boolean(imposterPackage);
    const imposterVersion = normalizeEntityId(
        imposterPackage?.impostorizerVersion
    );

    useEffect(() => {
        setGalleryIndex((index) =>
            Math.min(index, Math.max(0, galleryImages.length - 1))
        );
    }, [galleryImages.length]);

    useEffect(() => {
        setGalleryIndex(0);
    }, [avatar.id]);

    async function copyAvatarText(text, label) {
        await copyTextToClipboard(text);
        toast.success(
            t('dialog.avatar.generated_dynamic.value_copied', {
                value: label
            })
        );
    }

    function openAvatarAuthor() {
        if (!avatar.authorId) {
            return;
        }

        openUserDialog({
            userId: avatar.authorId,
            title: avatar.authorName || undefined
        });
    }

    function openPrimaryImagePreview() {
        if (!imageUrl && !avatar.imageUrl) {
            return;
        }

        openImagePreview({
            url: convertFileUrlToImageUrl(avatar.imageUrl || imageUrl, 1024),
            title: avatar.name || avatarFallbackLabel
        });
    }

    function openGalleryPreview() {
        if (!currentGalleryImage) {
            return;
        }

        openImagePreview({
            url: currentGalleryImage,
            title: avatar.name || avatarFallbackLabel
        });
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={avatar.name || avatar.id || avatarFallbackLabel}
                imagePlaceholder={
                    <ImageIcon className="text-muted-foreground size-8" />
                }
                onImageClick={
                    imageUrl || avatar.imageUrl ? openPrimaryImagePreview : null
                }
                title={avatar.name || avatarFallbackLabel}
                onTitleClick={
                    avatar.name
                        ? () =>
                              void copyAvatarText(
                                  avatar.name,
                                  t('dialog.avatar.info.name')
                              )
                        : undefined
                }
                subtitle={avatar.authorName || ''}
                onSubtitleClick={avatar.authorId ? openAvatarAuthor : undefined}
                description={avatar.description}
                detail={detail}
                badges={
                    <AvatarDialogHeaderBadges
                        avatar={avatar}
                        isCurrentAvatar={isCurrentAvatar}
                        avatarBlocked={avatarBlocked}
                        isFavorite={isFavorite}
                        platformInfo={platformInfo}
                        fileAnalysis={fileAnalysis}
                        contentTags={contentTags}
                        authorTags={authorTags}
                        hasImposter={hasImposter}
                        imposterVersion={imposterVersion}
                        onOpenCache={onOpenCache}
                    />
                }
                actions={
                    <AvatarDialogHeaderActions
                        avatar={avatar}
                        state={{
                            actionStatus,
                            avatarBlocked,
                            isCurrentAvatar
                        }}
                        capabilities={{
                            canManageAvatar,
                            canSelectAvatar,
                            canSelectFallbackAvatar,
                            hasImposter
                        }}
                        links={{ avatarUrl, packageUrl }}
                        actions={{
                            onDeleteCache,
                            onSelect,
                            onRefresh,
                            onCopyText: copyAvatarText,
                            onOpenLink: openExternalLink,
                            onSelectFallback,
                            onReleaseStatus,
                            onRename,
                            onChangeDescription,
                            onChangeContentTags,
                            onChangeStylesAndAuthorTags,
                            onChangeImage,
                            onRegenerateImposter,
                            onDeleteImposter,
                            onCreateImposter,
                            onAvatarBlock,
                            onDelete
                        }}
                    />
                }
            />
            <EntityDialogTabs
                value={activeTab}
                onValueChange={changeTab}
                tabs={tabs}
            >
                <AvatarDialogInfoTab
                    avatar={avatar}
                    memo={memo}
                    canManageAvatar={canManageAvatar}
                    actionStatus={actionStatus}
                    media={{
                        galleryImages,
                        currentGalleryImage,
                        galleryIndex,
                        listings
                    }}
                    tags={{
                        localTags,
                        contentTags,
                        authorTags,
                        otherTags
                    }}
                    platformInfo={platformInfo}
                    onOpenAuthor={openAvatarAuthor}
                    onOpenGalleryPreview={openGalleryPreview}
                    onGalleryIndexChange={setGalleryIndex}
                    onUploadGallery={onUploadGallery}
                    onSaveMemo={onSaveMemo}
                />
                <EntityDialogTabContent value="json">
                    <EntityRawJson
                        value={{
                            avatar,
                            memo,
                            avatarBlocked,
                            galleryImages,
                            platformInfo,
                            fileAnalysis
                        }}
                    />
                </EntityDialogTabContent>
            </EntityDialogTabs>
        </EntityDialogScaffold>
    );
}
