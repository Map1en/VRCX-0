import { CopyIcon, ExternalLinkIcon, PersonStandingIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { openUserDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { getPlatformInfo } from '@/shared/utils/avatarPlatform';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { AvatarDialogGalleryTab } from './avatar-dialog/components/AvatarDialogGalleryTab';
import { AvatarDialogHeaderActions } from './avatar-dialog/components/AvatarDialogHeaderActions';
import { AvatarDialogHeaderBadges } from './avatar-dialog/components/AvatarDialogHeaderBadges';
import { AvatarDialogInfoTab } from './avatar-dialog/components/AvatarDialogInfoTab';
import { useAvatarDialogClipboard } from './avatar-dialog/useAvatarDialogClipboard';
import { useAvatarDialogPreview } from './avatar-dialog/useAvatarDialogPreview';
import {
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityDialogTwoColumnLayout,
    EntityOverviewCard,
    EntityRawJson
} from './EntityDialogScaffold';

function firstArray(...values: any[]) {
    return values.find((value: any) => Array.isArray(value)) || [];
}

function normalizeEntityId(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function resolveAvatarDialogTab(
    tabs: any,
    preferred: any,
    fallback: any = 'info'
) {
    return tabs.some((tab: any) => tab.value === preferred)
        ? preferred
        : fallback;
}

function compactAvatarId(avatarId: any) {
    if (!avatarId || avatarId.length <= 22) {
        return avatarId || '';
    }
    return `${avatarId.slice(0, 16)}\u2026${avatarId.slice(-4)}`;
}

function compactAvatarUrl(url: any) {
    if (!url) {
        return '';
    }

    const displayUrl = url.replace(/^https?:\/\//, '');
    if (displayUrl.length <= 26) {
        return displayUrl;
    }

    return `${displayUrl.slice(0, 20)}\u2026${displayUrl.slice(-4)}`;
}

function AvatarOverviewFactRow({ label, value, children }: any) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-muted-foreground min-w-0 truncate">
                {label}
            </span>
            {children || (
                <span className="text-muted-foreground/80 min-w-0 truncate text-right">
                    {value || '\u2014'}
                </span>
            )}
        </div>
    );
}

function AvatarOverviewReferences({
    avatar,
    avatarUrl,
    onCopyAvatarId,
    onCopyAvatarUrl,
    onOpenAvatarUrl
}: any) {
    const { t } = useTranslation();

    if (!avatar.id && !avatarUrl) {
        return null;
    }

    return (
        <div className="text-muted-foreground/80 flex min-w-0 flex-col gap-1 text-xs">
            {avatar.id ? (
                <AvatarOverviewFactRow label={t('dialog.avatar.info.id')}>
                    <span className="flex min-w-0 items-center justify-end gap-1">
                        <span
                            className="text-muted-foreground/80 min-w-0 truncate font-mono text-[11px]"
                            title={avatar.id}
                        >
                            {compactAvatarId(avatar.id)}
                        </span>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    aria-label={t('dialog.avatar.info.copy_id')}
                                    size="icon-xs"
                                    variant="ghost"
                                    className="shrink-0"
                                    onClick={onCopyAvatarId}
                                >
                                    <CopyIcon data-icon="inline-start" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('dialog.avatar.info.copy_id')}
                            </TooltipContent>
                        </Tooltip>
                    </span>
                </AvatarOverviewFactRow>
            ) : null}
            {avatarUrl ? (
                <AvatarOverviewFactRow label={t('dialog.avatar.info.url')}>
                    <span className="flex min-w-0 items-center justify-end gap-1">
                        <span
                            className="text-muted-foreground/80 min-w-0 truncate font-mono text-[11px]"
                            title={avatarUrl}
                        >
                            {compactAvatarUrl(avatarUrl)}
                        </span>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    aria-label={t('common.actions.open_link')}
                                    size="icon-xs"
                                    variant="ghost"
                                    className="shrink-0"
                                    onClick={onOpenAvatarUrl}
                                >
                                    <ExternalLinkIcon data-icon="inline-start" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('common.actions.open_link')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    aria-label={t(
                                        'dialog.avatar.info.copy_url'
                                    )}
                                    size="icon-xs"
                                    variant="ghost"
                                    className="shrink-0"
                                    onClick={onCopyAvatarUrl}
                                >
                                    <CopyIcon data-icon="inline-start" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('dialog.avatar.info.copy_url')}
                            </TooltipContent>
                        </Tooltip>
                    </span>
                </AvatarOverviewFactRow>
            ) : null}
        </div>
    );
}

function AvatarDialogOverviewSection({
    avatar,
    avatarFallbackLabel,
    imageUrl,
    avatarUrl,
    badges,
    actions,
    onImageClick,
    onTitleClick,
    onAuthorClick,
    onCopyAvatarId,
    onCopyAvatarUrl,
    onOpenAvatarUrl
}: any) {
    const imageClickable = Boolean(
        (imageUrl || avatar.imageUrl) && onImageClick
    );

    return (
        <EntityOverviewCard
            media={
                <Button
                    type="button"
                    variant="ghost"
                    disabled={!imageClickable}
                    onClick={onImageClick}
                    className={cn(
                        'bg-muted aspect-[4/3] h-auto w-full overflow-hidden rounded-lg border p-0 disabled:pointer-events-none',
                        imageClickable ? 'cursor-pointer' : 'cursor-default'
                    )}
                >
                    {imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={
                                avatar.name || avatar.id || avatarFallbackLabel
                            }
                            className="size-full object-cover"
                        />
                    ) : (
                        <span className="flex size-full items-center justify-center">
                            <PersonStandingIcon className="text-muted-foreground size-10" />
                        </span>
                    )}
                </Button>
            }
        >
            <div className="flex min-w-0 flex-col gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    disabled={!avatar.name}
                    className="hover:text-primary h-auto min-w-0 justify-start overflow-hidden p-0 text-left text-lg leading-tight font-semibold whitespace-normal disabled:pointer-events-none disabled:opacity-100"
                    onClick={avatar.name ? onTitleClick : undefined}
                >
                    <span className="line-clamp-2 min-w-0 break-words">
                        {avatar.name || avatarFallbackLabel}
                    </span>
                </Button>
                {avatar.authorName ? (
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={!avatar.authorId}
                        className="text-muted-foreground hover:text-primary h-auto max-w-full min-w-0 justify-start overflow-hidden p-0 text-left font-mono text-sm disabled:pointer-events-none disabled:opacity-100"
                        onClick={avatar.authorId ? onAuthorClick : undefined}
                    >
                        <span className="truncate">{avatar.authorName}</span>
                    </Button>
                ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">{actions}</div>

            {badges ? (
                <div className="flex flex-wrap gap-1.5">{badges}</div>
            ) : null}

            {avatar.description ? (
                <>
                    <Separator />
                    <div className="text-muted-foreground max-h-28 overflow-auto text-sm break-words whitespace-pre-wrap">
                        {avatar.description}
                    </div>
                </>
            ) : null}

            <Separator />
            <AvatarOverviewReferences
                avatar={avatar}
                avatarUrl={avatarUrl}
                onCopyAvatarId={onCopyAvatarId}
                onCopyAvatarUrl={onCopyAvatarUrl}
                onOpenAvatarUrl={onOpenAvatarUrl}
            />
        </EntityOverviewCard>
    );
}

export function AvatarDialogTabbedView({
    avatarControls,
    avatar,
    avatarView,
    imageUrl
}: any) {
    const { t } = useTranslation();
    const {
        memo,
        detail,
        actionStatus,
        avatarBlocked,
        isCurrentAvatar,
        canManageAvatar,
        canSelectAvatar,
        canSelectFallbackAvatar,
        fileAnalysis = {}
    } = avatarView;
    const {
        onRefresh,
        onSelect,
        onSelectFallback,
        onReleaseStatus,
        onAvatarBlock,
        onSaveMemo,
        onOpenCache,
        onDeleteCache,
        onUploadGallery,
        onEditDetails,
        onChangeContentTags,
        onChangeImage,
        onCreateImposter,
        onDeleteImposter,
        onRegenerateImposter,
        onDelete
    } = avatarControls;

    const [activeTab, setActiveTab] = useState('info');
    const [galleryIndex, setGalleryIndex] = useState(0);
    const copyAvatarText = useAvatarDialogClipboard();
    const openImagePreview = useAvatarDialogPreview();
    const avatarFallbackLabel = t('view.favorites.empty.avatar_fallback');
    const avatarUrl = avatar.id
        ? `https://vrchat.com/home/avatar/${avatar.id}`
        : '';
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
    const contentTags = remoteTags.filter((tag: any) =>
        tag.startsWith('content_')
    );
    const authorTags = remoteTags.filter((tag: any) =>
        tag.startsWith('author_tag_')
    );
    const otherTags = remoteTags.filter(
        (tag: any) =>
            !tag.startsWith('content_') && !tag.startsWith('author_tag_')
    );
    const imposterPackage = Array.isArray(avatar.unityPackages)
        ? avatar.unityPackages.find(
              (unityPackage: any) => unityPackage?.variant === 'impostor'
          )
        : null;
    const hasImposter = Boolean(imposterPackage);
    const imposterVersion = normalizeEntityId(
        imposterPackage?.impostorizerVersion
    );
    const hasGalleryTab =
        galleryImages.length > 0 || listings.length > 0 || canManageAvatar;
    const tabs = [
        { value: 'info', label: t('dialog.avatar.info.header') },
        ...(hasGalleryTab
            ? [
                  {
                      value: 'gallery',
                      label: t('dialog.avatar.info.gallery')
                  }
              ]
            : []),
        { value: 'json', label: t('dialog.avatar.json.header') }
    ];

    function changeTab(tab: any) {
        setActiveTab(resolveAvatarDialogTab(tabs, tab));
    }

    useEffect(() => {
        setGalleryIndex((index: any) =>
            Math.min(index, Math.max(0, galleryImages.length - 1))
        );
    }, [galleryImages.length]);

    useEffect(() => {
        setGalleryIndex(0);
        setActiveTab('info');
    }, [avatar.id]);

    useEffect(() => {
        setActiveTab((tab: any) => resolveAvatarDialogTab(tabs, tab));
    }, [hasGalleryTab]);

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
        <EntityDialogScaffold className="gap-3">
            <EntityDialogTwoColumnLayout
                railMaxHeight="44vh"
                rail={
                    <AvatarDialogOverviewSection
                        avatar={avatar}
                        avatarFallbackLabel={avatarFallbackLabel}
                        imageUrl={imageUrl}
                        avatarUrl={avatarUrl}
                        onImageClick={
                            imageUrl || avatar.imageUrl
                                ? openPrimaryImagePreview
                                : null
                        }
                        onTitleClick={
                            avatar.name
                                ? () => {
                                      copyAvatarText(
                                          avatar.name,
                                          t('dialog.avatar.info.name')
                                      );
                                  }
                                : undefined
                        }
                        onAuthorClick={openAvatarAuthor}
                        onCopyAvatarId={() => {
                            copyAvatarText(
                                avatar.id,
                                t('dialog.avatar.info.id')
                            );
                        }}
                        onCopyAvatarUrl={() => {
                            copyAvatarText(
                                avatarUrl,
                                t('dialog.avatar.info.url')
                            );
                        }}
                        onOpenAvatarUrl={() => openExternalLink(avatarUrl)}
                        badges={
                            <AvatarDialogHeaderBadges
                                avatar={avatar}
                                isCurrentAvatar={isCurrentAvatar}
                                avatarBlocked={avatarBlocked}
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
                                avatarMenuModel={{
                                    actionStatus,
                                    avatar,
                                    avatarBlocked,
                                    canManageAvatar,
                                    canSelectAvatar,
                                    canSelectFallbackAvatar,
                                    hasImposter,
                                    isCurrentAvatar,
                                    packageUrl
                                }}
                                avatarMenuCommands={{
                                    onAvatarBlock,
                                    onChangeContentTags,
                                    onChangeImage,
                                    onCreateImposter,
                                    onDelete,
                                    onDeleteCache,
                                    onDeleteImposter,
                                    onEditDetails,
                                    onOpenLink: openExternalLink,
                                    onRefresh,
                                    onRegenerateImposter,
                                    onReleaseStatus,
                                    onSelect,
                                    onSelectFallback
                                }}
                            />
                        }
                    />
                }
            >
                <EntityDialogTabs
                    value={activeTab}
                    onValueChange={changeTab}
                    tabs={tabs}
                >
                    <AvatarDialogInfoTab
                        avatar={avatar}
                        memo={memo}
                        detail={detail}
                        tags={{
                            localTags,
                            contentTags,
                            authorTags,
                            otherTags
                        }}
                        platformInfo={platformInfo}
                        onOpenAuthor={openAvatarAuthor}
                        onSaveMemo={onSaveMemo}
                    />
                    {hasGalleryTab ? (
                        <AvatarDialogGalleryTab
                            canManageAvatar={canManageAvatar}
                            actionStatus={actionStatus}
                            media={{
                                galleryImages,
                                currentGalleryImage,
                                galleryIndex,
                                listings
                            }}
                            onOpenGalleryPreview={openGalleryPreview}
                            onGalleryIndexChange={setGalleryIndex}
                            onUploadGallery={onUploadGallery}
                        />
                    ) : null}
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
            </EntityDialogTwoColumnLayout>
        </EntityDialogScaffold>
    );
}
