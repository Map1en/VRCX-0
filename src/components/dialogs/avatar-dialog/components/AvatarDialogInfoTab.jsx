import { ImageIcon, UploadIcon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { Button } from '@/ui/shadcn/button';

import {
    EntityDialogTabContent,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea
} from '../../EntityDialogScaffold.jsx';
import { AvatarDialogTagList } from './AvatarDialogTagList.jsx';

const EMPTY_VALUE = '\u2014';

function getPlatformSummary(platformInfo) {
    return [
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
        .join(', ');
}

export function AvatarDialogInfoTab({
    avatar,
    memo,
    canManageAvatar,
    actionStatus,
    media,
    tags,
    platformInfo,
    onOpenAuthor,
    onOpenGalleryPreview,
    onGalleryIndexChange,
    onUploadGallery,
    onSaveMemo
}) {
    const { t } = useTranslation();

    const { galleryImages, currentGalleryImage, galleryIndex, listings } = media;
    const { localTags, contentTags, authorTags, otherTags } = tags;
    const platformSummary = getPlatformSummary(platformInfo);

    return (
        <EntityDialogTabContent value="info" forceMount>
            <EntityInfoGrid>
                {galleryImages.length || canManageAvatar ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.generated.gallery')}
                        full
                    >
                        <div className="mt-2 flex w-full flex-col gap-2">
                            {canManageAvatar ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={actionStatus === 'gallery-upload'}
                                    onClick={onUploadGallery}
                                >
                                    <UploadIcon data-icon="inline-start" />
                                    {t('dialog.avatar.generated.upload')}
                                </Button>
                            ) : null}
                            {galleryImages.length ? (
                                <div className="flex flex-col gap-2">
                                    <Button
                                        type="button"
                                        disabled={!currentGalleryImage}
                                        variant="outline"
                                        className="bg-muted/20 h-52 w-full overflow-hidden p-0"
                                        onClick={onOpenGalleryPreview}
                                    >
                                        {currentGalleryImage ? (
                                            <img
                                                src={currentGalleryImage}
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
                                            disabled={galleryImages.length <= 1}
                                            onClick={() =>
                                                onGalleryIndexChange(
                                                    (currentIndex) =>
                                                        (currentIndex +
                                                            galleryImages.length -
                                                            1) %
                                                        galleryImages.length
                                                )
                                            }
                                        >
                                            {t('table.pagination.previous')}
                                        </Button>
                                        <span>
                                            {galleryIndex + 1} / {galleryImages.length}
                                        </span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={galleryImages.length <= 1}
                                            onClick={() =>
                                                onGalleryIndexChange(
                                                    (currentIndex) =>
                                                        (currentIndex + 1) %
                                                        galleryImages.length
                                                )
                                            }
                                        >
                                            {t('table.pagination.next')}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-muted-foreground rounded-md border border-dashed p-4 text-xs">
                                    {t('dialog.avatar.generated.no_gallery_images')}
                                </div>
                            )}
                        </div>
                    </EntityInfoBlock>
                ) : null}
                {listings.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.generated.published_listings')}
                        full
                    >
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
                                            t('dialog.avatar.info.listings')}
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
                    label={t('dialog.avatar.generated.memo')}
                    value={memo}
                    placeholder={t('dialog.avatar.generated.memo')}
                    onSave={onSaveMemo}
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.info.id')}
                    value={avatar.id}
                    mono
                    full
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.generated.author')}
                    onClick={avatar.authorId ? onOpenAuthor : undefined}
                >
                    <span className="block truncate text-xs">
                        {avatar.authorName || EMPTY_VALUE}
                    </span>
                </EntityInfoBlock>
                <EntityInfoBlock
                    label={t('dialog.avatar.generated.created_at')}
                    value={
                        avatar.created_at || avatar.createdAt
                            ? formatDateFilter(
                                  avatar.created_at || avatar.createdAt,
                                  'long'
                              )
                            : EMPTY_VALUE
                    }
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.generated.last_updated')}
                    value={
                        avatar.updated_at || avatar.updatedAt
                            ? formatDateFilter(
                                  avatar.updated_at || avatar.updatedAt,
                                  'long'
                              )
                            : EMPTY_VALUE
                    }
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.generated.version')}
                    value={avatar.version ? String(avatar.version) : EMPTY_VALUE}
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.generated.time_spent')}
                    value={
                        avatar.$timeSpent
                            ? timeToText(avatar.$timeSpent)
                            : EMPTY_VALUE
                    }
                />
                <EntityInfoBlock
                    label={t('dialog.avatar.generated.platform')}
                    full
                >
                    <span className="block text-xs whitespace-normal">
                        {platformSummary || EMPTY_VALUE}
                    </span>
                </EntityInfoBlock>
                {localTags.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.generated.local_tags')}
                        full
                    >
                        <AvatarDialogTagList
                            tags={localTags.map((entry) => entry.tag)}
                        />
                    </EntityInfoBlock>
                ) : null}
                {contentTags.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.generated.content_tags')}
                        full
                    >
                        <AvatarDialogTagList
                            tags={contentTags}
                            trimPrefix="content_"
                        />
                    </EntityInfoBlock>
                ) : null}
                {authorTags.length ? (
                    <EntityInfoBlock
                        label={t('dialog.world.info.author_tags')}
                        full
                    >
                        <AvatarDialogTagList
                            tags={authorTags}
                            trimPrefix="author_tag_"
                        />
                    </EntityInfoBlock>
                ) : null}
                {otherTags.length ? (
                    <EntityInfoBlock
                        label={t('dialog.avatar.generated.vrchat_tags')}
                        full
                    >
                        <AvatarDialogTagList tags={otherTags} />
                    </EntityInfoBlock>
                ) : null}
            </EntityInfoGrid>
        </EntityDialogTabContent>
    );
}
