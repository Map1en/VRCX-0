import {
    AppleIcon,
    BanIcon,
    CheckCircleIcon,
    CopyIcon,
    DownloadIcon,
    ExternalLinkIcon,
    HeartIcon,
    ImageIcon,
    MonitorIcon,
    PencilIcon,
    RefreshCwIcon,
    Share2Icon,
    SmartphoneIcon,
    Trash2Icon,
    UploadIcon,
    UserIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/lib/entityMedia.js';
import { openUserDialog } from '@/services/dialogService.js';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils.js';
import { useModalStore } from '@/state/modalStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea,
    EntityRawJson
} from './EntityDialogScaffold.jsx';
import { appI18n } from '@/services/i18nService.js';

function PlatformBadge({ label, rating, fileSize, icon: Icon }) {
    return (
        <Badge variant="outline">
            {Icon ? <Icon data-icon="inline-start" /> : null}
            {label}
            {rating ? (
                <span className="ml-1 border-l pl-1">{rating}</span>
            ) : null}
            {fileSize ? (
                <span className="ml-1 border-l pl-1">{fileSize}</span>
            ) : null}
        </Badge>
    );
}

function TagList({ tags, trimPrefix = '' }) {
    if (!tags.length) {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
                <Badge key={tag} variant="outline">
                    {trimPrefix ? tag.replace(trimPrefix, '') : tag}
                </Badge>
            ))}
        </div>
    );
}

function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
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
    platformInfo,
    fileAnalysis = {},
    localTags,
    contentTags,
    authorTags,
    otherTags,
    hasImposter,
    imposterVersion,
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
    const [activeTab, setActiveTab] = useState(() => lastAvatarDialogTab);
    const [galleryIndex, setGalleryIndex] = useState(0);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const tabs = [
        { value: 'info', label: 'Info' },
        { value: 'json', label: 'JSON' }
    ];

    function changeTab(tab) {
        lastAvatarDialogTab = resolveAvatarDialogTab(tabs, tab);
        setActiveTab(lastAvatarDialogTab);
    }
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
        toast.success(appI18n.t('dialog.avatar.generated_dynamic.value_copied', { value: label }));
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={avatar.name || avatar.id || 'Avatar'}
                imagePlaceholder={
                    <ImageIcon className="text-muted-foreground size-8" />
                }
                onImageClick={
                    imageUrl
                        ? () =>
                              openImagePreview({
                                  url: convertFileUrlToImageUrl(
                                      avatar.imageUrl || imageUrl,
                                      1024
                                  ),
                                  title: avatar.name || 'Avatar'
                              })
                        : null
                }
                title={avatar.name || 'Avatar'}
                onTitleClick={
                    avatar.name
                        ? () => void copyAvatarText(avatar.name, 'Avatar name')
                        : undefined
                }
                subtitle={avatar.authorName || ''}
                onSubtitleClick={
                    avatar.authorId
                        ? () =>
                              openUserDialog({
                                  userId: avatar.authorId,
                                  title: avatar.authorName || undefined
                              })
                        : undefined
                }
                description={avatar.description}
                detail={detail}
                badges={
                    <>
                        <Badge
                            variant={
                                avatar.releaseStatus === 'public'
                                    ? 'default'
                                    : 'outline'
                            }
                        >
                            {avatar.releaseStatus === 'public'
                                ? 'Public'
                                : 'Private'}
                        </Badge>
                        {isCurrentAvatar ? (
                            <Badge variant="secondary">
                                <UserIcon data-icon="inline-start" />
                                {appI18n.t('common.current_session')}
                            </Badge>
                        ) : null}
                        {avatarBlocked ? (
                            <Badge variant="destructive">{appI18n.t('dialog.avatar.generated.blocked')}</Badge>
                        ) : null}
                        {isFavorite ? (
                            <Badge>
                                <HeartIcon
                                    data-icon="inline-start"
                                    className="fill-current"
                                />
                                {appI18n.t('dialog.avatar.generated.favorite')}
                            </Badge>
                        ) : null}
                        {avatar.$isCached ? (
                            <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                className="rounded-full"
                                onClick={onOpenCache}
                            >
                                {avatar.$cacheSize
                                    ? `${avatar.$cacheSize} Cache`
                                    : 'Local cache'}
                            </Button>
                        ) : null}
                        {hasImposter ? (
                            <Badge variant="outline">
                                {appI18n.t('dialog.avatar.tags.impostor')}
                                {imposterVersion ? ` v${imposterVersion}` : ''}
                            </Badge>
                        ) : null}
                        {avatar.styles?.primary || avatar.styles?.secondary ? (
                            <Badge variant="outline">
                                {appI18n.t('view.favorite.avatars.styles')} {avatar.styles?.primary || ''}
                                {avatar.styles?.secondary
                                    ? ` / ${avatar.styles.secondary}`
                                    : ''}
                            </Badge>
                        ) : null}
                        {avatar.unityPackageUrl || avatar.unityPackage?.url ? (
                            <Badge variant="outline">{appI18n.t('dialog.avatar.generated.future_proofing')}</Badge>
                        ) : null}
                        {avatar.tags?.some((tag) => /quest/i.test(tag)) ? (
                            <Badge variant="outline">{appI18n.t('dialog.avatar.tags.fallback')}</Badge>
                        ) : null}
                        {platformInfo?.pc?.platform ? (
                            <PlatformBadge
                                label="PC"
                                rating={platformInfo.pc.performanceRating}
                                fileSize={
                                    fileAnalysis.standalonewindows?._fileSize
                                }
                                icon={MonitorIcon}
                            />
                        ) : null}
                        {platformInfo?.android?.platform ? (
                            <PlatformBadge
                                label={appI18n.t('dialog.avatar.generated.android')}
                                rating={platformInfo.android.performanceRating}
                                fileSize={fileAnalysis.android?._fileSize}
                                icon={SmartphoneIcon}
                            />
                        ) : null}
                        {platformInfo?.ios?.platform ? (
                            <PlatformBadge
                                label="iOS"
                                rating={platformInfo.ios.performanceRating}
                                fileSize={fileAnalysis.ios?._fileSize}
                                icon={AppleIcon}
                            />
                        ) : null}
                        {contentTags.map((tag) => (
                            <Badge key={tag} variant="outline">
                                {tag.replace('content_', '')}
                            </Badge>
                        ))}
                        {authorTags.map((tag) => (
                            <Badge key={tag} variant="outline">
                                {tag.replace('author_tag_', '')}
                            </Badge>
                        ))}
                    </>
                }
                actions={
                    <>
                        {avatar.$isCached ? (
                            <Button
                                type="button"
                                size="icon-lg"
                                variant="outline"
                                className="rounded-full"
                                aria-label={"Delete cached avatar"}
                                disabled={actionStatus === 'cache'}
                                onClick={onDeleteCache}
                            >
                                <Trash2Icon data-icon="inline-start" />
                            </Button>
                        ) : null}
                        <FavoriteActionMenu
                            kind="avatar"
                            entityId={avatar.id}
                            entity={avatar}
                        />
                        <Button
                            type="button"
                            size="icon-lg"
                            className="rounded-full"
                            aria-label={"Select avatar"}
                            disabled={
                                !canSelectAvatar || actionStatus === 'selecting'
                            }
                            onClick={onSelect}
                        >
                            <CheckCircleIcon data-icon="inline-start" />
                        </Button>
                        <EntityActionDropdown
                            busy={actionStatus !== 'idle'}
                            dangerous={avatarBlocked}
                        >
                            <EntityActionItem
                                icon={RefreshCwIcon}
                                disabled={actionStatus === 'refresh'}
                                onSelect={onRefresh}
                            >
                                {appI18n.t('common.actions.refresh')}
                            </EntityActionItem>
                            {avatarUrl ? (
                                <>
                                    <EntityActionItem
                                        icon={Share2Icon}
                                        onSelect={() =>
                                            void copyAvatarText(
                                                avatarUrl,
                                                'Avatar URL'
                                            )
                                        }
                                    >
                                        {appI18n.t('dialog.avatar.generated.share_copy_url')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ExternalLinkIcon}
                                        onSelect={() =>
                                            openExternalLink(avatarUrl)
                                        }
                                    >
                                        {appI18n.t('dialog.avatar.generated.open_vrchat_page')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={CopyIcon}
                                        onSelect={() =>
                                            void copyAvatarText(
                                                avatar.id,
                                                'Avatar ID'
                                            )
                                        }
                                    >
                                        {appI18n.t('dialog.avatar.generated.copy_avatar_id')}
                                    </EntityActionItem>
                                </>
                            ) : null}
                            <EntityActionSeparator />
                            <EntityActionItem
                                icon={UserIcon}
                                disabled={
                                    !canSelectFallbackAvatar ||
                                    actionStatus === 'fallback'
                                }
                                onSelect={onSelectFallback}
                            >
                                {appI18n.t('dialog.avatar.actions.select_fallback')}
                            </EntityActionItem>
                            {canManageAvatar && packageUrl ? (
                                <EntityActionItem
                                    icon={DownloadIcon}
                                    onSelect={() =>
                                        openExternalLink(packageUrl)
                                    }
                                >
                                    {appI18n.t('dialog.avatar.generated.download_unity_package')}
                                </EntityActionItem>
                            ) : null}
                            {canManageAvatar ? (
                                <>
                                    <EntityActionItem
                                        icon={UserIcon}
                                        disabled={
                                            actionStatus === 'release-status'
                                        }
                                        onSelect={() =>
                                            onReleaseStatus(
                                                avatar.releaseStatus ===
                                                    'public'
                                                    ? 'private'
                                                    : 'public'
                                            )
                                        }
                                    >
                                        {avatar.releaseStatus === 'public'
                                            ? 'Make Private'
                                            : 'Make Public'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'rename'}
                                        onSelect={onRename}
                                    >
                                        {appI18n.t('dialog.avatar.generated.rename')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={
                                            actionStatus === 'description'
                                        }
                                        onSelect={onChangeDescription}
                                    >
                                        {appI18n.t('dialog.avatar.generated.change_description')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'tags'}
                                        onSelect={onChangeContentTags}
                                    >
                                        {appI18n.t('dialog.avatar.actions.change_content_tags')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus === 'styles'}
                                        onSelect={onChangeStylesAndAuthorTags}
                                    >
                                        {appI18n.t('dialog.avatar.actions.change_styles_author_tags')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ImageIcon}
                                        disabled={
                                            actionStatus === 'image-upload'
                                        }
                                        onSelect={onChangeImage}
                                    >
                                        {appI18n.t('dialog.avatar.generated.change_image')}
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                    {hasImposter ? (
                                        <>
                                            <EntityActionItem
                                                icon={RefreshCwIcon}
                                                destructive
                                                disabled={
                                                    actionStatus === 'imposter'
                                                }
                                                onSelect={onRegenerateImposter}
                                            >
                                                {appI18n.t('dialog.avatar.actions.regenerate_impostor')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={Trash2Icon}
                                                destructive
                                                disabled={
                                                    actionStatus === 'imposter'
                                                }
                                                onSelect={onDeleteImposter}
                                            >
                                                {appI18n.t('dialog.avatar.actions.delete_impostor')}
                                            </EntityActionItem>
                                        </>
                                    ) : (
                                        <EntityActionItem
                                            icon={UserIcon}
                                            disabled={
                                                actionStatus === 'imposter'
                                            }
                                            onSelect={onCreateImposter}
                                        >
                                            {appI18n.t('dialog.avatar.actions.create_impostor')}
                                        </EntityActionItem>
                                    )}
                                </>
                            ) : null}
                            {!isCurrentAvatar ? (
                                <EntityActionItem
                                    icon={BanIcon}
                                    destructive={avatarBlocked}
                                    disabled={actionStatus === 'avatar-block'}
                                    onSelect={() =>
                                        onAvatarBlock(!avatarBlocked)
                                    }
                                >
                                    {avatarBlocked
                                        ? 'Unblock Avatar'
                                        : 'Block Avatar'}
                                </EntityActionItem>
                            ) : null}
                            {canManageAvatar ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={Trash2Icon}
                                        destructive
                                        disabled={actionStatus === 'delete'}
                                        onSelect={onDelete}
                                    >
                                        {appI18n.t('common.actions.delete')}
                                    </EntityActionItem>
                                </>
                            ) : null}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs
                value={activeTab}
                onValueChange={changeTab}
                tabs={tabs}
            >
                <EntityDialogTabContent value="info" forceMount>
                    <EntityInfoGrid>
                        {galleryImages.length || canManageAvatar ? (
                            <EntityInfoBlock label={appI18n.t('dialog.avatar.generated.gallery')} full>
                                <div className="mt-2 flex w-full flex-col gap-2">
                                    {canManageAvatar ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                actionStatus ===
                                                'gallery-upload'
                                            }
                                            onClick={onUploadGallery}
                                        >
                                            <UploadIcon data-icon="inline-start" />
                                            {appI18n.t('dialog.avatar.generated.upload')}
                                        </Button>
                                    ) : null}
                                    {galleryImages.length ? (
                                        <div className="flex flex-col gap-2">
                                            <Button
                                                type="button"
                                                disabled={!currentGalleryImage}
                                                variant="outline"
                                                className="bg-muted/20 h-52 w-full overflow-hidden p-0"
                                                onClick={() =>
                                                    openImagePreview({
                                                        url: currentGalleryImage,
                                                        title:
                                                            avatar.name ||
                                                            'Avatar'
                                                    })
                                                }
                                            >
                                                {currentGalleryImage ? (
                                                    <img
                                                        src={
                                                            currentGalleryImage
                                                        }
                                                        alt=""
                                                        className="size-full object-contain"
                                                    />
                                                ) : (
                                                    <span className="text-muted-foreground flex size-full items-center justify-center [&>svg]:size-8">
                                                        <ImageIcon />
                                                    </span>
                                                )}
                                            </Button>
                                            <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={
                                                        galleryImages.length <=
                                                        1
                                                    }
                                                    onClick={() =>
                                                        setGalleryIndex(
                                                            (index) =>
                                                                (index +
                                                                    galleryImages.length -
                                                                    1) %
                                                                galleryImages.length
                                                        )
                                                    }
                                                >
                                                    {appI18n.t('table.pagination.previous')}
                                                </Button>
                                                <span>
                                                    {galleryIndex + 1} /{' '}
                                                    {galleryImages.length}
                                                </span>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={
                                                        galleryImages.length <=
                                                        1
                                                    }
                                                    onClick={() =>
                                                        setGalleryIndex(
                                                            (index) =>
                                                                (index + 1) %
                                                                galleryImages.length
                                                        )
                                                    }
                                                >
                                                    {appI18n.t('table.pagination.next')}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-muted-foreground rounded-md border border-dashed p-4 text-xs">
                                            {appI18n.t('dialog.avatar.generated.no_gallery_images')}
                                        </div>
                                    )}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        {listings.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.avatar.generated.published_listings')} full>
                                <div className="flex flex-col gap-2">
                                    {listings.map((listing, index) => (
                                        <div
                                            key={`${listing?.id || listing?.platform || index}`}
                                            className="box-border flex items-center p-1.5 text-sm"
                                        >
                                            <div className="font-medium">
                                                {listing?.displayName ||
                                                    listing?.name ||
                                                    listing?.platform ||
                                                    listing?.id ||
                                                    'Listing'}
                                            </div>
                                            <div className="text-muted-foreground text-xs">
                                                {listing?.description ||
                                                    listing?.createdAt ||
                                                    listing?.id ||
                                                    ''}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityMemoTextarea
                            label={appI18n.t('dialog.avatar.generated.memo')}
                            value={memo}
                            placeholder={appI18n.t('dialog.avatar.generated.memo')}
                            onSave={onSaveMemo}
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.avatar.info.id')}
                            value={avatar.id}
                            mono
                            full
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.avatar.generated.author')}
                            onClick={
                                avatar.authorId
                                    ? () =>
                                          openUserDialog({
                                              userId: avatar.authorId,
                                              title:
                                                  avatar.authorName || undefined
                                          })
                                    : undefined
                            }
                        >
                            <span className="block truncate text-xs">
                                {avatar.authorName || '—'}
                            </span>
                        </EntityInfoBlock>
                        <EntityInfoBlock
                            label={appI18n.t('dialog.avatar.generated.created_at')}
                            value={
                                avatar.created_at || avatar.createdAt
                                    ? formatDateFilter(
                                          avatar.created_at || avatar.createdAt,
                                          'long'
                                      )
                                    : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.avatar.generated.last_updated')}
                            value={
                                avatar.updated_at || avatar.updatedAt
                                    ? formatDateFilter(
                                          avatar.updated_at || avatar.updatedAt,
                                          'long'
                                      )
                                    : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.avatar.generated.version')}
                            value={
                                avatar.version ? String(avatar.version) : '—'
                            }
                        />
                        <EntityInfoBlock
                            label={appI18n.t('dialog.avatar.generated.time_spent')}
                            value={
                                avatar.$timeSpent
                                    ? timeToText(avatar.$timeSpent)
                                    : '—'
                            }
                        />
                        <EntityInfoBlock label={appI18n.t('dialog.avatar.generated.platform')} full>
                            <span className="block text-xs whitespace-normal">
                                {[
                                    platformInfo?.pc?.platform
                                        ? `PC ${platformInfo.pc.performanceRating || ''}`
                                        : '',
                                    platformInfo?.android?.platform
                                        ? `Android ${platformInfo.android.performanceRating || ''}`
                                        : '',
                                    platformInfo?.ios?.platform
                                        ? `iOS ${platformInfo.ios.performanceRating || ''}`
                                        : ''
                                ]
                                    .filter(Boolean)
                                    .join(', ') || '—'}
                            </span>
                        </EntityInfoBlock>
                        {localTags.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.avatar.generated.local_tags')} full>
                                <TagList
                                    tags={localTags.map((entry) => entry.tag)}
                                />
                            </EntityInfoBlock>
                        ) : null}
                        {contentTags.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.avatar.generated.content_tags')} full>
                                <TagList
                                    tags={contentTags}
                                    trimPrefix="content_"
                                />
                            </EntityInfoBlock>
                        ) : null}
                        {authorTags.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.world.info.author_tags')} full>
                                <TagList
                                    tags={authorTags}
                                    trimPrefix="author_tag_"
                                />
                            </EntityInfoBlock>
                        ) : null}
                        {otherTags.length ? (
                            <EntityInfoBlock label={appI18n.t('dialog.avatar.generated.vrchat_tags')} full>
                                <TagList tags={otherTags} />
                            </EntityInfoBlock>
                        ) : null}
                    </EntityInfoGrid>
                </EntityDialogTabContent>
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
