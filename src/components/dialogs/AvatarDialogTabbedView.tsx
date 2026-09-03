import { CopyIcon, ExternalLinkIcon, PersonStandingIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import { openUserDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { vrchatAvatarUrl } from '@/shared/constants/vrchatWebUrls';
import { vrcxAvatarDeepLink } from '@/shared/constants/vrcxDeepLinks';
import {
    getPlatformInfo,
    hasAvatarPerformanceDetails
} from '@/shared/utils/avatarPlatform';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type {
    AvatarControls,
    AvatarDialogTab,
    AvatarGalleryEntry,
    AvatarListing,
    AvatarViewRecord,
    AvatarViewState
} from './avatar-dialog/avatarDialogTypes';
import { AvatarDialogGalleryTab } from './avatar-dialog/components/AvatarDialogGalleryTab';
import { AvatarDialogHeaderActions } from './avatar-dialog/components/AvatarDialogHeaderActions';
import { AvatarDialogHeaderBadges } from './avatar-dialog/components/AvatarDialogHeaderBadges';
import { AvatarDialogInfoTab } from './avatar-dialog/components/AvatarDialogInfoTab';
import { AvatarDialogPerformanceTab } from './avatar-dialog/components/AvatarDialogPerformanceTab';
import { useAvatarDialogClipboard } from './avatar-dialog/useAvatarDialogClipboard';
import { useAvatarDialogPreview } from './avatar-dialog/useAvatarDialogPreview';
import {
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityDialogTwoColumnLayout,
    EntityFactAction,
    EntityFactList,
    EntityFactRow,
    EntityFactValue,
    EntityOverviewCard,
    EntityRawJson
} from './EntityDialogScaffold';

function firstArray<T>(...values: (T[] | null | undefined)[]): T[];
function firstArray(...values: unknown[]) {
    const result = values.find(Array.isArray);
    return Array.isArray(result) ? result : [];
}

function normalizeEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function resolveAvatarDialogTab(
    tabs: ReadonlyArray<{ value: AvatarDialogTab }>,
    preferred: string,
    fallback: AvatarDialogTab = 'info'
): AvatarDialogTab {
    return tabs.find((tab) => tab.value === preferred)?.value ?? fallback;
}

function compactAvatarId(avatarId: string): string {
    if (!avatarId || avatarId.length <= 22) {
        return avatarId || '';
    }
    return `${avatarId.slice(0, 16)}\u2026${avatarId.slice(-4)}`;
}

function compactAvatarUrl(url: string): string {
    if (!url) {
        return '';
    }

    const displayUrl = url.replace(/^https?:\/\//, '');
    if (displayUrl.length <= 26) {
        return displayUrl;
    }

    return `${displayUrl.slice(0, 20)}\u2026${displayUrl.slice(-4)}`;
}

function AvatarOverviewReferences({
    avatar,
    avatarUrl,
    onCopyAvatarId,
    onCopyAvatarUrl,
    onCopyVrcxAvatarUrl,
    vrcxAvatarUrl,
    onOpenAvatarUrl
}: {
    avatar: AvatarViewRecord;
    avatarUrl: string;
    onCopyAvatarId(): void;
    onCopyAvatarUrl(): void;
    onCopyVrcxAvatarUrl(): void;
    vrcxAvatarUrl: string;
    onOpenAvatarUrl(): void;
}) {
    const { t } = useTranslation();

    if (!avatar.id && !avatarUrl) {
        return null;
    }

    return (
        <EntityFactList>
            {avatar.id ? (
                <EntityFactRow label={t('dialog.avatar.info.id')}>
                    <EntityFactValue
                        display={compactAvatarId(avatar.id)}
                        title={avatar.id}
                    >
                        <EntityFactAction
                            label={t('dialog.avatar.info.copy_id')}
                            icon={CopyIcon}
                            onClick={onCopyAvatarId}
                        />
                    </EntityFactValue>
                </EntityFactRow>
            ) : null}
            {avatarUrl ? (
                <EntityFactRow label={t('dialog.avatar.info.url')}>
                    <EntityFactValue
                        display={compactAvatarUrl(avatarUrl)}
                        title={avatarUrl}
                    >
                        <EntityFactAction
                            label={t('common.actions.view_on_website')}
                            icon={ExternalLinkIcon}
                            onClick={onOpenAvatarUrl}
                        />
                        <EntityFactAction
                            label={t('dialog.avatar.info.copy_url')}
                            icon={CopyIcon}
                            onClick={onCopyAvatarUrl}
                        />
                    </EntityFactValue>
                </EntityFactRow>
            ) : null}
            {vrcxAvatarUrl ? (
                <EntityFactRow
                    label={
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <span
                                        className="cursor-help underline decoration-dotted underline-offset-2"
                                        tabIndex={0}
                                    >
                                        {t('dialog.avatar.info.vrcx_url')}
                                    </span>
                                }
                            />
                            <TooltipContent>
                                {t('dialog.avatar.info.vrcx_url_description')}
                            </TooltipContent>
                        </Tooltip>
                    }
                >
                    <EntityFactValue
                        display={compactAvatarUrl(vrcxAvatarUrl)}
                        title={vrcxAvatarUrl}
                    >
                        <EntityFactAction
                            label={t('dialog.avatar.info.copy_vrcx_url')}
                            icon={CopyIcon}
                            onClick={onCopyVrcxAvatarUrl}
                        />
                    </EntityFactValue>
                </EntityFactRow>
            ) : null}
        </EntityFactList>
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
    onCopyVrcxAvatarUrl,
    vrcxAvatarUrl,
    onOpenAvatarUrl
}: {
    avatar: AvatarViewRecord;
    avatarFallbackLabel: string;
    imageUrl: string;
    avatarUrl: string;
    badges: ReactNode;
    actions: ReactNode;
    onImageClick?: () => void;
    onTitleClick?: () => void;
    onAuthorClick(): void;
    onCopyAvatarId(): void;
    onCopyAvatarUrl(): void;
    onCopyVrcxAvatarUrl(): void;
    vrcxAvatarUrl: string;
    onOpenAvatarUrl(): void;
}) {
    const { t } = useTranslation();
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
                        <FadeInImage
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
                <Tooltip>
                    <TooltipTrigger
                        render={
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
                        }
                    />
                    <TooltipContent>{t('common.actions.copy')}</TooltipContent>
                </Tooltip>
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
                onCopyVrcxAvatarUrl={onCopyVrcxAvatarUrl}
                vrcxAvatarUrl={vrcxAvatarUrl}
                onOpenAvatarUrl={onOpenAvatarUrl}
            />
        </EntityOverviewCard>
    );
}

export function AvatarDialogTabbedView({
    activeTab,
    avatarControls,
    avatar,
    avatarView,
    imageUrl,
    onActiveTabChange
}: {
    activeTab: AvatarDialogTab;
    avatarControls: AvatarControls;
    avatar: AvatarViewRecord;
    avatarView: AvatarViewState;
    imageUrl: string;
    onActiveTabChange(tab: AvatarDialogTab): void;
}) {
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
        fileAnalysis = {},
        fileAnalysisStatus,
        galleryStatus
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

    const [galleryIndex, setGalleryIndex] = useState(0);
    const copyAvatarText = useAvatarDialogClipboard();
    const openImagePreview = useAvatarDialogPreview();
    const avatarFallbackLabel = t('view.favorites.empty.avatar_fallback');
    const avatarUrl = avatar.id ? vrchatAvatarUrl(avatar.id) : '';
    const vrcxAvatarUrl =
        avatar.releaseStatus === 'public' ? vrcxAvatarDeepLink(avatar.id) : '';
    const packageUrl = replaceVrcPackageUrl(
        avatar.unityPackageUrl || avatar.unityPackage?.url || ''
    );
    const galleryImages = firstArray<AvatarGalleryEntry>(
        avatar.galleryImages,
        avatar.galleries,
        avatar.gallery
    );
    const listings = firstArray<AvatarListing>(
        avatar.publishedListings,
        avatar.listings
    );
    const currentGalleryEntry = galleryImages[galleryIndex] || null;
    const currentGalleryRawImage =
        typeof currentGalleryEntry === 'string'
            ? currentGalleryEntry
            : currentGalleryEntry?.imageUrl ||
              currentGalleryEntry?.thumbnailImageUrl ||
              currentGalleryEntry?.fileUrl ||
              '';
    const currentGalleryImage = currentGalleryRawImage
        ? convertFileUrlToImageUrl(currentGalleryRawImage, 1024)
        : '';
    const platformInfo = getPlatformInfo(
        avatar.unityPackages,
        avatar.performance,
        fileAnalysis
    );
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
              (unityPackage) => unityPackage.variant === 'impostor'
          )
        : null;
    const hasImposter = Boolean(imposterPackage);
    const imposterVersion = normalizeEntityId(
        imposterPackage?.impostorizerVersion
    );
    const showPerformanceTab =
        fileAnalysisStatus === 'running' ||
        fileAnalysisStatus === 'pending' ||
        hasAvatarPerformanceDetails(fileAnalysis);
    const tabs = useMemo((): Array<{
        value: AvatarDialogTab;
        label: string;
    }> => {
        const items: Array<{
            value: AvatarDialogTab;
            label: string;
        }> = [{ value: 'info', label: t('dialog.avatar.info.header') }];
        if (showPerformanceTab) {
            items.push({
                value: 'performance',
                label: t('dialog.avatar.performance.header')
            });
        }
        items.push(
            {
                value: 'gallery',
                label: t('dialog.avatar.info.gallery')
            },
            { value: 'json', label: t('dialog.avatar.json.header') }
        );
        return items;
    }, [showPerformanceTab, t]);

    function changeTab(tab: string) {
        onActiveTabChange(resolveAvatarDialogTab(tabs, tab));
    }

    useEffect(() => {
        setGalleryIndex((index) =>
            Math.min(index, Math.max(0, galleryImages.length - 1))
        );
    }, [galleryImages.length]);

    useEffect(() => {
        setGalleryIndex(0);
    }, [avatar.id]);

    useEffect(() => {
        const resolvedTab = resolveAvatarDialogTab(tabs, activeTab);
        if (resolvedTab !== activeTab) {
            onActiveTabChange(resolvedTab);
        }
    }, [activeTab, onActiveTabChange, tabs]);

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
                                : undefined
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
                        onCopyVrcxAvatarUrl={() => {
                            copyAvatarText(
                                t('dialog.avatar.info.vrcx_share_text', {
                                    name: avatar.name,
                                    url: vrcxAvatarUrl
                                }),
                                t('dialog.avatar.info.vrcx_url')
                            );
                        }}
                        vrcxAvatarUrl={vrcxAvatarUrl}
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
                    <AvatarDialogPerformanceTab
                        platformInfo={platformInfo}
                        fileAnalysis={fileAnalysis}
                        loading={fileAnalysisStatus === 'running'}
                        pending={fileAnalysisStatus === 'pending'}
                    />
                    <AvatarDialogGalleryTab
                        canManageAvatar={canManageAvatar}
                        actionStatus={actionStatus}
                        galleryStatus={galleryStatus}
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
                    <EntityDialogTabContent value="json">
                        <EntityRawJson value={avatar} />
                    </EntityDialogTabContent>
                </EntityDialogTabs>
            </EntityDialogTwoColumnLayout>
        </EntityDialogScaffold>
    );
}
