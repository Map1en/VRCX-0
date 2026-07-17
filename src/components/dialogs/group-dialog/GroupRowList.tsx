import {
    EyeIcon,
    ImageIcon,
    MessageSquareIcon,
    PencilIcon,
    TagIcon,
    UserIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import { openUserDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Button } from '@/ui/shadcn/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    getGroupRoleNameMap,
    getGroupRowImage,
    getGroupRowLabel,
    getGroupRowRawImage,
    groupRowsEmptyTitle
} from './groupDialogUtils';
import { GroupListState } from './GroupListState';

type RowAction = (row: EntityRecord) => void;

interface RowListActions {
    onPreviewImage?: (url: string, title: string) => void;
    onEditPost?: RowAction;
    onDeletePost?: RowAction;
}

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function PostList({
    rows,
    group,
    onPreviewImage,
    canManagePosts,
    onEditPost,
    onDeletePost
}: RowListActions & {
    rows: EntityRecord[];
    group: GroupProfileRecord | null;
    canManagePosts: boolean;
}) {
    const { t } = useTranslation();

    const rolesById = getGroupRoleNameMap(group);
    return (
        <div className="flex flex-wrap items-start">
            {rows.map((post, index) => {
                const image = getGroupRowRawImage(post);
                const title = text(post.title) || 'Post';
                return (
                    <div
                        key={text(post.id) || `${title}:${index}`}
                        className="box-border flex w-full items-center p-1.5 text-sm"
                    >
                        <div className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate leading-5 font-medium">
                                {title}
                            </span>
                            {image ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="mr-1.5 h-auto p-0 align-top"
                                    aria-label={t(
                                        'accessibility.preview_image',
                                        { item: title }
                                    )}
                                    onClick={() =>
                                        onPreviewImage?.(image, title)
                                    }
                                >
                                    <FadeInImage
                                        src={convertFileUrlToImageUrl(
                                            image,
                                            128
                                        )}
                                        alt=""
                                        className="size-16 rounded-md object-cover"
                                    />
                                </Button>
                            ) : null}
                            <pre className="text-muted-foreground inline-block align-top font-sans text-xs whitespace-pre-wrap">
                                {text(post.text) || '—'}
                            </pre>
                            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                {Array.isArray(post?.roleIds) &&
                                post.roleIds.length ? (
                                    <span className="inline-flex items-center gap-1 truncate">
                                        <EyeIcon data-icon="inline-start" />
                                        {post.roleIds
                                            .map(
                                                (roleId) =>
                                                    rolesById.get(
                                                        text(roleId)
                                                    ) || text(roleId)
                                            )
                                            .join(', ')}
                                    </span>
                                ) : null}
                                {text(post.createdAt) ? (
                                    <span>{text(post.createdAt)}</span>
                                ) : null}
                                {text(post.authorId) ? (
                                    <span>{text(post.authorId)}</span>
                                ) : null}
                            </div>
                        </div>
                        {canManagePosts ? (
                            <div className="ml-2 flex shrink-0 items-center gap-1">
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t('common.actions.edit')}
                                    onClick={() => onEditPost?.(post)}
                                >
                                    <PencilIcon data-icon="inline-start" />
                                </Button>
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    aria-label={t('common.actions.delete')}
                                    onClick={() => onDeletePost?.(post)}
                                >
                                    <MessageSquareIcon data-icon="inline-start" />
                                </Button>
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

type GalleryEntry = {
    gallery: { id: string; name: string; description?: string };
    rows: EntityRecord[];
};

function PhotoGalleryRows({
    rows,
    loading,
    error,
    onPreviewImage
}: RowListActions & {
    rows: EntityRecord[];
    loading: boolean;
    error: string;
}) {
    const { t } = useTranslation();

    const groups = new Map<string, GalleryEntry>();
    for (const row of rows) {
        const galleryId = text(row.$galleryId) || 'gallery';
        if (!groups.has(galleryId)) {
            groups.set(galleryId, {
                gallery: {
                    id: galleryId,
                    name: text(row.$galleryName) || 'Gallery'
                },
                rows: []
            });
        }
        groups.get(galleryId)?.rows.push(row);
    }
    const galleryEntries = Array.from(groups.values());
    const [activeGallery, setActiveGallery] = useState(
        galleryEntries[0]?.gallery?.id || ''
    );

    useEffect(() => {
        if (
            galleryEntries.length &&
            !galleryEntries.some((entry) => entry.gallery.id === activeGallery)
        ) {
            setActiveGallery(galleryEntries[0].gallery.id);
        }
    }, [activeGallery, galleryEntries]);

    if (loading) {
        return (
            <GroupListState title={t('dialog.group.gallery.header')} loading />
        );
    }
    if (error) {
        return (
            <GroupListState
                title={t('dialog.group.gallery.header')}
                error={error}
            />
        );
    }
    if (!galleryEntries.length) {
        return <GroupListState title={t('dialog.group.gallery.header')} />;
    }

    return (
        <Tabs
            value={activeGallery}
            onValueChange={setActiveGallery}
            className="gap-2"
        >
            <TabsList
                variant="line"
                className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1"
            >
                {galleryEntries.map(({ gallery, rows: galleryRows }) => (
                    <TabsTrigger
                        key={gallery.id}
                        value={gallery.id}
                        className="flex-none rounded-none px-3"
                    >
                        <span className="font-bold">
                            {gallery.name || 'Gallery'}
                        </span>
                        <span className="text-muted-foreground ml-1.5 text-xs">
                            {galleryRows.length}
                        </span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {galleryEntries.map(({ gallery, rows: galleryRows }) => (
                <TabsContent
                    key={gallery.id}
                    value={gallery.id}
                    className="m-0"
                >
                    {gallery.description ? (
                        <div className="text-muted-foreground px-2 py-1 text-sm">
                            {gallery.description}
                        </div>
                    ) : null}
                    <div className="grid max-h-[60vh] gap-4 overflow-y-auto pt-2 sm:grid-cols-2 lg:grid-cols-3">
                        {galleryRows.map((row, index) => {
                            const image = getGroupRowImage(row, 'photos');
                            return (
                                <Button
                                    key={`${getGroupRowLabel(row)}:${index}`}
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full flex-col items-stretch overflow-hidden rounded-md border p-0 text-left text-sm"
                                    onClick={() =>
                                        onPreviewImage?.(
                                            getGroupRowRawImage(row),
                                            getGroupRowLabel(row)
                                        )
                                    }
                                >
                                    {image ? (
                                        <FadeInImage
                                            src={image}
                                            alt={getGroupRowLabel(row)}
                                            className="max-h-52 w-full object-contain"
                                        />
                                    ) : (
                                        <div className="bg-muted flex h-52 w-full items-center justify-center">
                                            <ImageIcon className="text-muted-foreground" />
                                        </div>
                                    )}
                                </Button>
                            );
                        })}
                    </div>
                </TabsContent>
            ))}
        </Tabs>
    );
}

export function RowList({
    rows,
    group = null,
    kind = '',
    loading = false,
    error = '',
    onPreviewImage,
    canManagePosts = false,
    onEditPost,
    onDeletePost
}: RowListActions & {
    rows: EntityRecord[];
    group?: GroupProfileRecord | null;
    kind?: string;
    loading?: boolean;
    error?: string;
    canManagePosts?: boolean;
}) {
    if (loading) {
        return <GroupListState title={groupRowsEmptyTitle(kind)} loading />;
    }
    if (error) {
        return (
            <GroupListState title={groupRowsEmptyTitle(kind)} error={error} />
        );
    }
    if (kind === 'photos') {
        return (
            <PhotoGalleryRows
                rows={rows}
                loading={loading}
                error={error}
                onPreviewImage={onPreviewImage}
            />
        );
    }
    if (!rows.length) {
        return <GroupListState title={groupRowsEmptyTitle(kind)} />;
    }
    if (kind === 'posts') {
        return (
            <PostList
                rows={rows}
                group={group}
                onPreviewImage={onPreviewImage}
                canManagePosts={canManagePosts}
                onEditPost={onEditPost}
                onDeletePost={onDeletePost}
            />
        );
    }

    return (
        <div className="flex flex-wrap items-start">
            {rows.map((row, index) => {
                const label = getGroupRowLabel(row);
                const image = getGroupRowImage(row, kind);
                const user = isRecord(row.user) ? row.user : null;
                const memberUserId = text(row.userId || user?.id);
                const rolesById = getGroupRoleNameMap(group);
                const memberRoles = Array.isArray(row?.roleIds)
                    ? row.roleIds
                          .map(
                              (roleId) => rolesById.get(text(roleId)) || 'Role'
                          )
                          .filter(Boolean)
                    : [];
                const subtitle = memberRoles.join(', ') || '';
                return (
                    <Button
                        key={`${label}:${index}`}
                        type="button"
                        variant="ghost"
                        className="box-border h-auto w-44 justify-start p-1.5 text-left text-sm"
                        onClick={() => {
                            if (kind === 'members' && memberUserId) {
                                openUserDialog({
                                    userId: memberUserId,
                                    title: text(user?.displayName) || undefined,
                                    seedData: user
                                });
                            }
                        }}
                    >
                        {image ? (
                            <FadeInImage
                                src={image}
                                alt=""
                                className="mr-2.5 size-9 shrink-0 rounded-full object-cover"
                            />
                        ) : (
                            <div className="bg-muted mr-2.5 flex size-9 shrink-0 items-center justify-center rounded-full">
                                <UserIcon className="text-muted-foreground" />
                            </div>
                        )}
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate leading-5 font-medium">
                                {label}
                            </span>
                            {subtitle ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    {subtitle}
                                </span>
                            ) : null}
                            {kind === 'members' ? (
                                <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                                    {row.isRepresenting ? (
                                        <TagIcon data-icon="inline-start" />
                                    ) : null}
                                    {row.visibility &&
                                    row.visibility !== 'visible' ? (
                                        <EyeIcon data-icon="inline-start" />
                                    ) : null}
                                    {row.isSubscribedToAnnouncements ===
                                    false ? (
                                        <MessageSquareIcon data-icon="inline-start" />
                                    ) : null}
                                    {row.managerNotes ? (
                                        <PencilIcon data-icon="inline-start" />
                                    ) : null}
                                </span>
                            ) : null}
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}
