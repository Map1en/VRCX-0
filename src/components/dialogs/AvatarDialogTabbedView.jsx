import { useEffect, useState } from 'react';
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
import { toast } from 'sonner';

import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { convertFileUrlToImageUrl, copyTextToClipboard, openExternalLink } from '@/lib/entityMedia.js';
import { replaceVrcPackageUrl } from '@/shared/utils/urlUtils.js';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { openUserDialog } from '@/services/dialogService.js';
import { useModalStore } from '@/state/modalStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
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

function PlatformBadge({ label, rating, fileSize, icon: Icon }) {
    return (
        <Badge variant="outline">
            {Icon ? <Icon className="mr-1 size-3.5" /> : null}
            {label}
            {rating ? <span className="ml-1 border-l pl-1">{rating}</span> : null}
            {fileSize ? <span className="ml-1 border-l pl-1">{fileSize}</span> : null}
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
    const avatarUrl = avatar.id ? `https://vrchat.com/home/avatar/${avatar.id}` : '';
    const packageUrl = replaceVrcPackageUrl(avatar.unityPackageUrl || avatar.unityPackage?.url || '');
    const galleryImages = firstArray(avatar.galleryImages, avatar.galleries, avatar.gallery);
    const listings = firstArray(avatar.publishedListings, avatar.listings);
    const currentGalleryEntry = galleryImages[galleryIndex] || null;
    const currentGalleryRawImage = currentGalleryEntry?.imageUrl || currentGalleryEntry?.thumbnailImageUrl || currentGalleryEntry?.fileUrl || currentGalleryEntry || '';
    const currentGalleryImage = currentGalleryRawImage ? convertFileUrlToImageUrl(currentGalleryRawImage, 1024) : '';

    useEffect(() => {
        setGalleryIndex((index) => Math.min(index, Math.max(0, galleryImages.length - 1)));
    }, [galleryImages.length]);

    useEffect(() => {
        setGalleryIndex(0);
    }, [avatar.id]);

    async function copyAvatarText(text, label) {
        await copyTextToClipboard(text);
        toast.success(`${label} copied.`);
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={avatar.name || avatar.id || 'Avatar'}
                imagePlaceholder={<ImageIcon className="size-8 text-muted-foreground" />}
                onImageClick={imageUrl ? () => openImagePreview({ url: convertFileUrlToImageUrl(avatar.imageUrl || imageUrl, 1024), title: avatar.name || 'Avatar' }) : null}
                title={avatar.name || 'Avatar'}
                onTitleClick={avatar.name ? () => void copyAvatarText(avatar.name, 'Avatar name') : undefined}
                subtitle={avatar.authorName || ''}
                onSubtitleClick={avatar.authorId ? () => openUserDialog({ userId: avatar.authorId, title: avatar.authorName || undefined }) : undefined}
                description={avatar.description}
                detail={detail}
                badges={
                    <>
                        <Badge variant={avatar.releaseStatus === 'public' ? 'default' : 'outline'}>{avatar.releaseStatus === 'public' ? 'Public' : 'Private'}</Badge>
                        {isCurrentAvatar ? <Badge variant="secondary"><UserIcon className="mr-1 size-3.5" />Current</Badge> : null}
                        {avatarBlocked ? <Badge variant="destructive">Blocked</Badge> : null}
                        {isFavorite ? <Badge><HeartIcon className="mr-1 size-3.5 fill-current" />Favorite</Badge> : null}
                        {avatar.$isCached ? (
                            <button type="button" onClick={onOpenCache}>
                                <Badge variant="outline">{avatar.$cacheSize ? `${avatar.$cacheSize} Cache` : 'Local cache'}</Badge>
                            </button>
                        ) : null}
                        {hasImposter ? <Badge variant="outline">Impostor{imposterVersion ? ` v${imposterVersion}` : ''}</Badge> : null}
                        {avatar.styles?.primary || avatar.styles?.secondary ? <Badge variant="outline">Styles {avatar.styles?.primary || ''}{avatar.styles?.secondary ? ` / ${avatar.styles.secondary}` : ''}</Badge> : null}
                        {avatar.unityPackageUrl || avatar.unityPackage?.url ? <Badge variant="outline">Future proofing</Badge> : null}
                        {avatar.tags?.some((tag) => /quest/i.test(tag)) ? <Badge variant="outline">Fallback</Badge> : null}
                        {platformInfo?.pc?.platform ? <PlatformBadge label="PC" rating={platformInfo.pc.performanceRating} fileSize={fileAnalysis.standalonewindows?._fileSize} icon={MonitorIcon} /> : null}
                        {platformInfo?.android?.platform ? <PlatformBadge label="Android" rating={platformInfo.android.performanceRating} fileSize={fileAnalysis.android?._fileSize} icon={SmartphoneIcon} /> : null}
                        {platformInfo?.ios?.platform ? <PlatformBadge label="iOS" rating={platformInfo.ios.performanceRating} fileSize={fileAnalysis.ios?._fileSize} icon={AppleIcon} /> : null}
                        {contentTags.map((tag) => <Badge key={tag} variant="outline">{tag.replace('content_', '')}</Badge>)}
                        {authorTags.map((tag) => <Badge key={tag} variant="outline">{tag.replace('author_tag_', '')}</Badge>)}
                    </>
                }
                actions={
                    <>
                        {avatar.$isCached ? (
                            <Button type="button" size="icon-lg" variant="outline" className="rounded-full" disabled={actionStatus === 'cache'} onClick={onDeleteCache}>
                                <Trash2Icon className="size-4" />
                            </Button>
                        ) : null}
                        <FavoriteActionMenu kind="avatar" entityId={avatar.id} entity={avatar} />
                        <Button type="button" size="icon-lg" className="rounded-full" disabled={!canSelectAvatar || actionStatus === 'selecting'} onClick={onSelect}>
                            <CheckCircleIcon className="size-4" />
                        </Button>
                        <EntityActionDropdown busy={actionStatus !== 'idle'} dangerous={avatarBlocked}>
                            <EntityActionItem icon={RefreshCwIcon} disabled={actionStatus === 'refresh'} onSelect={onRefresh}>Refresh</EntityActionItem>
                            {avatarUrl ? (
                                <>
                                    <EntityActionItem icon={Share2Icon} onSelect={() => void copyAvatarText(avatarUrl, 'Avatar URL')}>Share / Copy URL</EntityActionItem>
                                    <EntityActionItem icon={ExternalLinkIcon} onSelect={() => openExternalLink(avatarUrl)}>Open VRChat Page</EntityActionItem>
                                    <EntityActionItem icon={CopyIcon} onSelect={() => void copyAvatarText(avatar.id, 'Avatar ID')}>Copy Avatar ID</EntityActionItem>
                                </>
                            ) : null}
                            <EntityActionSeparator />
                            <EntityActionItem icon={UserIcon} disabled={!canSelectFallbackAvatar || actionStatus === 'fallback'} onSelect={onSelectFallback}>Select Fallback Avatar</EntityActionItem>
                            {canManageAvatar && packageUrl ? <EntityActionItem icon={DownloadIcon} onSelect={() => openExternalLink(packageUrl)}>Download Unity Package</EntityActionItem> : null}
                            {canManageAvatar ? (
                                <>
                                    <EntityActionItem icon={UserIcon} disabled={actionStatus === 'release-status'} onSelect={() => onReleaseStatus(avatar.releaseStatus === 'public' ? 'private' : 'public')}>
                                        {avatar.releaseStatus === 'public' ? 'Make Private' : 'Make Public'}
                                    </EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'rename'} onSelect={onRename}>Rename</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'description'} onSelect={onChangeDescription}>Change Description</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'tags'} onSelect={onChangeContentTags}>Change Content Tags</EntityActionItem>
                                    <EntityActionItem icon={PencilIcon} disabled={actionStatus === 'styles'} onSelect={onChangeStylesAndAuthorTags}>Change Styles and Author Tags</EntityActionItem>
                                    <EntityActionItem icon={ImageIcon} disabled={actionStatus === 'image-upload'} onSelect={onChangeImage}>Change Image</EntityActionItem>
                                    <EntityActionSeparator />
                                    {hasImposter ? (
                                        <>
                                            <EntityActionItem icon={RefreshCwIcon} destructive disabled={actionStatus === 'imposter'} onSelect={onRegenerateImposter}>Regenerate Impostor</EntityActionItem>
                                            <EntityActionItem icon={Trash2Icon} destructive disabled={actionStatus === 'imposter'} onSelect={onDeleteImposter}>Delete Impostor</EntityActionItem>
                                        </>
                                    ) : (
                                        <EntityActionItem icon={UserIcon} disabled={actionStatus === 'imposter'} onSelect={onCreateImposter}>Create Impostor</EntityActionItem>
                                    )}
                                </>
                            ) : null}
                            {!isCurrentAvatar ? (
                                <EntityActionItem icon={BanIcon} destructive={avatarBlocked} disabled={actionStatus === 'avatar-block'} onSelect={() => onAvatarBlock(!avatarBlocked)}>
                                    {avatarBlocked ? 'Unblock Avatar' : 'Block Avatar'}
                                </EntityActionItem>
                            ) : null}
                            {canManageAvatar ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem icon={Trash2Icon} destructive disabled={actionStatus === 'delete'} onSelect={onDelete}>Delete</EntityActionItem>
                                </>
                            ) : null}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs value={activeTab} onValueChange={changeTab} tabs={tabs}>
                <EntityDialogTabContent value="info">
                    <EntityInfoGrid>
                    {galleryImages.length || canManageAvatar ? (
                        <EntityInfoBlock label="Gallery" full>
                            <div className="mt-2 w-full space-y-2">
                                {canManageAvatar ? (
                                    <Button type="button" size="sm" variant="outline" disabled={actionStatus === 'gallery-upload'} onClick={onUploadGallery}>
                                        <UploadIcon className="size-3.5" />
                                        Upload
                                    </Button>
                                ) : null}
                                {galleryImages.length ? (
                                    <div className="space-y-2">
                                        <button
                                            type="button"
                                            disabled={!currentGalleryImage}
                                            className="flex h-52 w-full items-center justify-center overflow-hidden rounded-md border bg-muted/20"
                                            onClick={() => openImagePreview({ url: currentGalleryImage, title: avatar.name || 'Avatar' })}>
                                            {currentGalleryImage ? (
                                                <img src={currentGalleryImage} alt="" className="size-full object-contain" />
                                            ) : (
                                                <ImageIcon className="size-8 text-muted-foreground" />
                                            )}
                                        </button>
                                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={galleryImages.length <= 1}
                                                onClick={() => setGalleryIndex((index) => (index + galleryImages.length - 1) % galleryImages.length)}>
                                                Previous
                                            </Button>
                                            <span>{galleryIndex + 1} / {galleryImages.length}</span>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={galleryImages.length <= 1}
                                                onClick={() => setGalleryIndex((index) => (index + 1) % galleryImages.length)}>
                                                Next
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                                        No gallery images.
                                    </div>
                                )}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                    {listings.length ? (
                        <EntityInfoBlock label="Published Listings" full>
                            <div className="space-y-2">
                                {listings.map((listing, index) => (
                                    <div key={`${listing?.id || listing?.platform || index}`} className="box-border flex items-center p-1.5 text-[13px]">
                                        <div className="font-medium">{listing?.displayName || listing?.name || listing?.platform || listing?.id || 'Listing'}</div>
                                        <div className="text-xs text-muted-foreground">{listing?.description || listing?.createdAt || listing?.id || ''}</div>
                                    </div>
                                ))}
                            </div>
                        </EntityInfoBlock>
                    ) : null}
                        <EntityMemoTextarea label="Memo" value={memo} placeholder="Memo" onSave={onSaveMemo} />
                        <EntityInfoBlock label="Avatar ID" value={avatar.id} mono full />
                        <EntityInfoBlock label="Author" onClick={avatar.authorId ? () => openUserDialog({ userId: avatar.authorId, title: avatar.authorName || undefined }) : undefined}>
                            <span className="block truncate text-xs">{avatar.authorName || '—'}</span>
                        </EntityInfoBlock>
                        <EntityInfoBlock label="Created At" value={(avatar.created_at || avatar.createdAt) ? formatDateFilter(avatar.created_at || avatar.createdAt, 'long') : '—'} />
                        <EntityInfoBlock label="Last Updated" value={(avatar.updated_at || avatar.updatedAt) ? formatDateFilter(avatar.updated_at || avatar.updatedAt, 'long') : '—'} />
                        <EntityInfoBlock label="Version" value={avatar.version ? String(avatar.version) : '—'} />
                        <EntityInfoBlock label="Time Spent" value={avatar.$timeSpent ? timeToText(avatar.$timeSpent) : '—'} />
                        <EntityInfoBlock label="Platform" full>
                            <span className="block whitespace-normal text-xs">
                                {[
                                    platformInfo?.pc?.platform ? `PC ${platformInfo.pc.performanceRating || ''}` : '',
                                    platformInfo?.android?.platform ? `Android ${platformInfo.android.performanceRating || ''}` : '',
                                    platformInfo?.ios?.platform ? `iOS ${platformInfo.ios.performanceRating || ''}` : ''
                                ].filter(Boolean).join(', ') || '—'}
                            </span>
                        </EntityInfoBlock>
                        {localTags.length ? <EntityInfoBlock label="Local Tags" full><TagList tags={localTags.map((entry) => entry.tag)} /></EntityInfoBlock> : null}
                        {contentTags.length ? <EntityInfoBlock label="Content Tags" full><TagList tags={contentTags} trimPrefix="content_" /></EntityInfoBlock> : null}
                        {authorTags.length ? <EntityInfoBlock label="Author Tags" full><TagList tags={authorTags} trimPrefix="author_tag_" /></EntityInfoBlock> : null}
                        {otherTags.length ? <EntityInfoBlock label="VRChat Tags" full><TagList tags={otherTags} /></EntityInfoBlock> : null}
                    </EntityInfoGrid>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="json"><EntityRawJson value={{ avatar, memo, avatarBlocked, galleryImages, platformInfo, fileAnalysis }} /></EntityDialogTabContent>
            </EntityDialogTabs>
        </EntityDialogScaffold>
    );
}
