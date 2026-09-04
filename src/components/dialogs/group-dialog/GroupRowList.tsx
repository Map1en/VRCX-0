import { useQuery } from '@tanstack/react-query';
import {
    EyeIcon,
    ImageIcon,
    MessageSquareIcon,
    PencilIcon,
    TagIcon,
    UserIcon
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import type {
    GroupGalleryPhotoRow,
    GroupMemberRow,
    GroupPostRecord,
    GroupProfileRecord
} from '@/domain/entities/group';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFact } from '@/lib/useKnownUser';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { useRuntimeStore } from '@/state/runtimeStore';
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

type GroupPostAction = (post: GroupPostRecord) => void;

interface RowListActions {
    onPreviewImage?: (url: string, title: string) => void;
    onEditPost?: GroupPostAction;
    onDeletePost?: GroupPostAction;
}

type RowListBaseProps = RowListActions & {
    group?: GroupProfileRecord | null;
    loading?: boolean;
    error?: string;
};

type RowListProps =
    | (RowListBaseProps & {
          kind: 'posts';
          rows: GroupPostRecord[];
          canManagePosts?: boolean;
      })
    | (RowListBaseProps & { kind: 'members'; rows: GroupMemberRow[] })
    | (RowListBaseProps & { kind: 'photos'; rows: GroupGalleryPhotoRow[] });

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function GroupPostUserButton({
    userId,
    displayName: providedDisplayName,
    label
}: {
    userId: string;
    displayName?: string;
    label?: ReactNode;
}) {
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const knownUser = useKnownUserFact(userId, {
        endpoint: currentEndpoint
    });
    const cachedDisplayName = text(
        providedDisplayName ||
            knownUser?.displayName ||
            knownUser?.username ||
            knownUser?.name
    );
    const userProfileQuery = useQuery({
        queryKey: queryKeys.user(userId, currentEndpoint),
        queryFn: () => userProfileRepository.getUserProfile({ userId }),
        enabled: Boolean(
            userId && (!cachedDisplayName || cachedDisplayName === userId)
        ),
        staleTime: entityQueryPolicies.userAvatarLookup.staleTime,
        gcTime: entityQueryPolicies.userAvatarLookup.gcTime,
        retry: entityQueryPolicies.userAvatarLookup.retry,
        refetchOnWindowFocus:
            entityQueryPolicies.userAvatarLookup.refetchOnWindowFocus
    });
    const queriedUser = userProfileQuery.data;
    const displayName = text(
        queriedUser?.displayName ||
            queriedUser?.username ||
            queriedUser?.name ||
            cachedDisplayName
    );

    if (!displayName || displayName === userId) {
        return null;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="hover:text-primary h-auto max-w-full justify-start gap-1 p-0 text-left text-xs"
            onClick={() =>
                openUserDialog({
                    userId,
                    title: displayName,
                    seedData: queriedUser || knownUser || null
                })
            }
        >
            {label}
            <span className="text-foreground truncate font-medium">
                {displayName}
            </span>
        </Button>
    );
}

function PostList({
    rows,
    group,
    onPreviewImage,
    canManagePosts,
    onEditPost,
    onDeletePost
}: RowListActions & {
    rows: GroupPostRecord[];
    group: GroupProfileRecord | null;
    canManagePosts: boolean;
}) {
    const { t } = useTranslation();

    const rolesById = getGroupRoleNameMap(group);
    return (
        <div className="flex flex-wrap items-start">
            {rows.map((post, index) => {
                const image = getGroupRowRawImage(post);
                const title = post.title || 'Post';
                const postRoleNames = (post.roleIds ?? []).map(
                    (roleId) => rolesById.get(roleId) || roleId
                );
                return (
                    <div
                        key={post.id || `${title}:${index}`}
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
                                {post.text || '—'}
                            </pre>
                            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                {postRoleNames.length ? (
                                    <span className="inline-flex items-center gap-1 truncate">
                                        <EyeIcon data-icon="inline-start" />
                                        {postRoleNames.join(', ')}
                                    </span>
                                ) : null}
                                {post.createdAt ? (
                                    <span>{post.createdAt}</span>
                                ) : null}
                                {post.authorId ? (
                                    <GroupPostUserButton
                                        userId={post.authorId}
                                    />
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
    rows: GroupGalleryPhotoRow[];
};

function PhotoGalleryRows({
    rows,
    loading,
    error,
    onPreviewImage
}: RowListActions & {
    rows: GroupGalleryPhotoRow[];
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
                variant="underline"
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

export function RowList(props: RowListProps) {
    const { kind, loading = false, error = '' } = props;
    if (loading) {
        return <GroupListState title={groupRowsEmptyTitle(kind)} loading />;
    }
    if (error) {
        return (
            <GroupListState title={groupRowsEmptyTitle(kind)} error={error} />
        );
    }
    if (props.kind === 'photos') {
        return (
            <PhotoGalleryRows
                rows={props.rows}
                loading={loading}
                error={error}
                onPreviewImage={props.onPreviewImage}
            />
        );
    }
    if (!props.rows.length) {
        return <GroupListState title={groupRowsEmptyTitle(kind)} />;
    }
    if (props.kind === 'posts') {
        return (
            <PostList
                rows={props.rows}
                group={props.group ?? null}
                onPreviewImage={props.onPreviewImage}
                canManagePosts={props.canManagePosts ?? false}
                onEditPost={props.onEditPost}
                onDeletePost={props.onDeletePost}
            />
        );
    }

    const group = props.group ?? null;
    return (
        <div className="flex flex-wrap items-start">
            {props.rows.map((row, index) => {
                const label = getGroupRowLabel(row);
                const image = getGroupRowImage(row, 'members');
                const user = row.user ?? null;
                const memberUserId = text(row.userId || user?.id);
                const rolesById = getGroupRoleNameMap(group);
                const memberRoles = Array.isArray(row.roleIds)
                    ? row.roleIds
                          .map((roleId) => rolesById.get(roleId) || 'Role')
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
                            if (memberUserId) {
                                openUserDialog({
                                    userId: memberUserId,
                                    title: user?.displayName || undefined,
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
                            <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                                {row.isRepresenting ? (
                                    <TagIcon data-icon="inline-start" />
                                ) : null}
                                {row.visibility &&
                                row.visibility !== 'visible' ? (
                                    <EyeIcon data-icon="inline-start" />
                                ) : null}
                                {row.isSubscribedToAnnouncements === false ? (
                                    <MessageSquareIcon data-icon="inline-start" />
                                ) : null}
                                {row.managerNotes ? (
                                    <PencilIcon data-icon="inline-start" />
                                ) : null}
                            </span>
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}
