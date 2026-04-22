import {
    DownloadIcon,
    EyeIcon,
    ImageIcon,
    MessageSquareIcon,
    PencilIcon,
    PlayIcon,
    RefreshCwIcon,
    TagIcon,
    Trash2Icon,
    UserIcon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { LocationWorld } from '@/components/LocationWorld.jsx';
import { formatDateFilter } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    userImage
} from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import {
    groupProfileRepository,
    mediaRepository
} from '@/repositories/index.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useModalStore } from '@/state/modalStore.js';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import { EntityInfoBlock } from '../EntityDialogScaffold.jsx';
import {
    languageOptionLabel,
    normalizeProfileLanguageRows
} from '../user-dialog/userProfileFields.js';
import { appI18n } from '@/services/i18nService.js';

export function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
}

export function firstText(...values) {
    for (const value of values) {
        if (value === null || value === undefined) {
            continue;
        }
        const text = String(value).trim();
        if (text) {
            return text;
        }
    }
    return '';
}

function groupRowsEmptyTitle(kind) {
    if (kind === 'posts') {
        return 'No posts';
    }
    if (kind === 'members') {
        return 'No members';
    }
    if (kind === 'photos') {
        return 'No photos';
    }
    return 'No rows';
}

function GroupListState({
    title = 'No rows',
    description = 'No matching entries.',
    loading = false,
    error = '',
    className = ''
}) {
    if (loading) {
        return (
            <div
                className={cn(
                    'text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm',
                    className
                )}
            >
                <Spinner className="size-4" />
                <span>{appI18n.t('dialog.group.generated.loading')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive" className={className}>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    return (
        <Empty className={cn('min-h-32 border', className)}>
            <EmptyHeader>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription>{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
        </Empty>
    );
}

export function normalizeGroupLanguages(group, languageOptionMap = new Map()) {
    return normalizeProfileLanguageRows(group, languageOptionMap);
}

export function GroupTitleLanguages({ languages }) {
    if (!languages.length) {
        return null;
    }

    return (
        <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
            {languages.map((language) => {
                const key = String(
                    language?.key || language?.value || ''
                ).trim();
                const label = languageOptionLabel(language);
                return (
                    <Badge
                        key={`${key}:${language?.value || ''}`}
                        variant="outline"
                        className="shrink-0 text-xs"
                        title={label}
                    >
                        {label}
                    </Badge>
                );
            })}
        </span>
    );
}

export function shouldShowGroupBadgeValue(value) {
    const normalizedValue = firstText(value).toLowerCase();
    return Boolean(normalizedValue && normalizedValue !== 'default');
}

function rowLabel(row) {
    if (typeof row === 'string') {
        return row;
    }
    if (!row || typeof row !== 'object') {
        return '—';
    }
    const label =
        row.title ||
        row.user?.displayName ||
        row.displayName ||
        row.name ||
        row.imageUrl ||
        '—';
    return row.$galleryName ? `${row.$galleryName}: ${label}` : label;
}

function rowImage(row, kind) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    if (kind === 'members') {
        return userImage(row.user || row, true, '64');
    }
    return convertFileUrlToImageUrl(rowRawImage(row), 256);
}

export function announcementRoleNames(announcement, group) {
    const rolesById = roleNameMap(group);
    return Array.isArray(announcement?.roleIds)
        ? announcement.roleIds
              .map((roleId) => rolesById.get(roleId) || roleId)
              .filter(Boolean)
        : [];
}

export function announcementTimestamp(value) {
    return value ? formatDateFilter(value, 'long') : '—';
}

export function announcementUserLabel(announcement, key) {
    return firstText(
        announcement?.[`${key}DisplayName`],
        announcement?.[`${key}Name`],
        announcement?.[`${key}Username`]
    );
}

export function announcementUserId(announcement, key) {
    return firstText(
        announcement?.[`${key}Id`],
        announcement?.[`${key}UserId`],
        announcement?.[key]?.id,
        announcement?.[key]?.userId
    );
}

function rowRawImage(row) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    const versions = Array.isArray(row.versions) ? row.versions : [];
    const latestVersion = versions[versions.length - 1];
    return (
        latestVersion?.file?.url ||
        row.imageUrl ||
        row.thumbnailImageUrl ||
        row.iconUrl ||
        row.fileUrl ||
        row.url ||
        ''
    );
}

function roleNameMap(group) {
    const map = new Map();
    for (const role of Array.isArray(group?.roles) ? group.roles : []) {
        if (role?.id) {
            map.set(role.id, role.name || 'Role');
        }
    }
    return map;
}

export function downloadJsonFile(fileName, value) {
    const blob = new Blob([JSON.stringify(value ?? null, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}

export function hasGroupPermission(group, permission) {
    const direct = Array.isArray(group?.myMember?.permissions)
        ? group.myMember.permissions
        : [];
    if (direct.includes('*') || direct.includes(permission)) {
        return true;
    }
    const roleIds = Array.isArray(group?.myMember?.roleIds)
        ? group.myMember.roleIds
        : [];
    return (Array.isArray(group?.roles) ? group.roles : [])
        .filter((role) => roleIds.includes(role?.id))
        .some(
            (role) =>
                Array.isArray(role.permissions) &&
                (role.permissions.includes('*') ||
                    role.permissions.includes(permission))
        );
}

export function hasGroupModerationPermission(group) {
    return [
        'group-invites-manage',
        'group-moderates-manage',
        'group-audit-view',
        'group-bans-manage',
        'group-data-manage',
        'group-members-manage',
        'group-members-remove',
        'group-roles-assign',
        'group-roles-manage',
        'group-default-role-manage'
    ].some((permission) => hasGroupPermission(group, permission));
}

function PostList({
    rows,
    group,
    onPreviewImage,
    canManagePosts,
    onEditPost,
    onDeletePost
}) {
    const rolesById = roleNameMap(group);
    return (
        <div className="flex flex-wrap items-start">
            {rows.map((post, index) => {
                const image = rowRawImage(post);
                return (
                    <div
                        key={post?.id || `${post?.title || 'post'}:${index}`}
                        className="box-border flex w-full items-center p-1.5 text-sm"
                    >
                        <div className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate leading-5 font-medium">
                                {post?.title || 'Post'}
                            </span>
                            {image ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="mr-1.5 h-auto p-0 align-top"
                                    aria-label={`Preview ${post?.title || 'post'} image`}
                                    onClick={() =>
                                        onPreviewImage?.(
                                            image,
                                            post?.title || 'Post'
                                        )
                                    }
                                >
                                    <img
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
                                {post?.text || '—'}
                            </pre>
                            <div className="text-muted-foreground mt-1 flex flex-wrap items-center justify-end gap-1.5 text-xs">
                                {Array.isArray(post?.roleIds) &&
                                post.roleIds.length ? (
                                    <Badge
                                        variant="outline"
                                        className="max-w-full"
                                    >
                                        <EyeIcon data-icon="inline-start" />
                                        <span className="truncate">
                                            {post.roleIds
                                                .map(
                                                    (roleId) =>
                                                        rolesById.get(roleId) ||
                                                        'Role'
                                                )
                                                .join(', ')}
                                        </span>
                                    </Badge>
                                ) : null}
                                {post?.authorDisplayName ? (
                                    <span>{post.authorDisplayName}</span>
                                ) : null}
                                {post?.editorDisplayName ? (
                                    <span>
                                        {appI18n.t('dialog.group.generated.edited_by')} {post.editorDisplayName}
                                    </span>
                                ) : null}
                                {post?.updatedAt ? (
                                    <span>
                                        {formatDateFilter(
                                            post.updatedAt,
                                            'long'
                                        )}
                                    </span>
                                ) : null}
                                {canManagePosts ? (
                                    <>
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label={"Edit post"}
                                            onClick={() => onEditPost?.(post)}
                                        >
                                            <PencilIcon data-icon="inline-start" />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label={"Delete post"}
                                            onClick={() => onDeletePost?.(post)}
                                        >
                                            <Trash2Icon data-icon="inline-start" />
                                        </Button>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function PhotoGalleryRows({ rows, group, loading, error, onPreviewImage }) {
    const galleries = Array.isArray(group?.galleries) ? group.galleries : [];
    const groups = new Map();
    for (const gallery of galleries) {
        if (gallery?.id) {
            groups.set(gallery.id, { gallery, rows: [] });
        }
    }
    for (const row of rows) {
        const galleryId =
            row?.$galleryId ||
            row?.galleryId ||
            row?.gallery_id ||
            row?.$galleryName ||
            'Gallery';
        if (!groups.has(galleryId)) {
            groups.set(galleryId, {
                gallery: {
                    id: galleryId,
                    name: row?.$galleryName || 'Gallery'
                },
                rows: []
            });
        }
        groups.get(galleryId).rows.push(row);
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
        return <GroupListState title={appI18n.t('dialog.group.generated.no_photos')} loading />;
    }
    if (error) {
        return <GroupListState title={appI18n.t('dialog.group.generated.no_photos')} error={error} />;
    }
    if (!galleryEntries.length) {
        return <GroupListState title={appI18n.t('dialog.group.generated.no_photos')} />;
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
                            const image = rowImage(row, 'photos');
                            return (
                                <Button
                                    key={`${rowLabel(row)}:${index}`}
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full flex-col items-stretch overflow-hidden rounded-md border p-0 text-left text-sm"
                                    onClick={() =>
                                        onPreviewImage?.(
                                            rowRawImage(row),
                                            rowLabel(row)
                                        )
                                    }
                                >
                                    {image ? (
                                        <img
                                            src={image}
                                            alt={rowLabel(row)}
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
                group={group}
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
                const label = rowLabel(row);
                const image = rowImage(row, kind);
                const memberUserId = row?.userId || row?.user?.id;
                const rolesById = roleNameMap(group);
                const memberRoles = Array.isArray(row?.roleIds)
                    ? row.roleIds
                          .map((roleId) => rolesById.get(roleId) || 'Role')
                          .filter(Boolean)
                    : [];
                const subtitle =
                    memberRoles.join(', ') ||
                    row?.user?.displayName ||
                    row?.displayName ||
                    '';
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
                                    title: row?.user?.displayName || undefined,
                                    seedData: row?.user || null
                                });
                            }
                        }}
                    >
                        {image ? (
                            <img
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
                                    {row?.isRepresenting ? (
                                        <TagIcon data-icon="inline-start" />
                                    ) : null}
                                    {row?.visibility &&
                                    row.visibility !== 'visible' ? (
                                        <EyeIcon data-icon="inline-start" />
                                    ) : null}
                                    {row?.isSubscribedToAnnouncements ===
                                    false ? (
                                        <MessageSquareIcon data-icon="inline-start" />
                                    ) : null}
                                    {row?.managerNotes ? (
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

function getInstanceLocation(instance) {
    const directLocation =
        instance?.location || instance?.tag || instance?.$location?.tag;
    if (directLocation) {
        return directLocation;
    }
    const worldId = instance?.worldId || instance?.world?.id;
    const instanceId = instance?.instanceId || instance?.id || instance?.name;
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function getInstanceTitle(instance) {
    return instance?.world?.name || instance?.worldName || instance?.name || '';
}

function getInstanceOwnerId(instance) {
    return firstText(
        instance?.ownerUserId,
        instance?.owner_user_id,
        instance?.ownerId,
        instance?.owner_id,
        instance?.creatorUserId,
        instance?.creator_user_id,
        instance?.userId,
        instance?.user_id,
        instance?.ownerUser?.id,
        instance?.ownerUser?.userId,
        instance?.owner?.id,
        instance?.owner?.userId,
        instance?.creatorUser?.id,
        instance?.creatorUser?.userId,
        instance?.user?.id,
        instance?.user?.userId,
        instance?.$location?.userId,
        instance?.$location?.user_id
    );
}

function getInstanceOwnerName(instance) {
    return firstText(
        instance?.ownerUser?.displayName,
        instance?.ownerUser?.username,
        instance?.owner?.displayName,
        instance?.owner?.username,
        instance?.creatorUser?.displayName,
        instance?.creatorUser?.username,
        instance?.user?.displayName,
        instance?.user?.username,
        instance?.ownerName,
        instance?.owner_name,
        instance?.ownerDisplayName,
        instance?.owner_display_name
    );
}

function getInstanceUsers(instance) {
    const users = firstArray(
        instance?.users,
        instance?.players,
        instance?.playerList,
        instance?.userList,
        instance?.ref?.users,
        instance?.ref?.players
    );
    if (users.length) {
        return users;
    }
    const usersById = instance?.usersById || instance?.ref?.usersById;
    return usersById && typeof usersById === 'object'
        ? Object.values(usersById)
        : [];
}

export function GroupInstanceRows({ instances, currentUserId, endpoint = '' }) {
    if (!instances.length) {
        return null;
    }

    async function launch(location) {
        if (!location) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parseLocation(location).shortName || '',
                endpoint
            );
            if (opened) {
                toast.success(appI18n.t('dialog.group.generated.vrchat_launch_request_sent'));
                return;
            }
            openWorldDialog({
                worldId: parseLocation(location).worldId || location
            });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.group.generated_toast.failed_to_launch_instance')
            );
        }
    }

    return (
        <EntityInfoBlock label={appI18n.t('dialog.group.generated.instances')} full>
            <div className="mt-1 flex flex-col gap-2">
                {instances.map((instance, index) => {
                    const location = getInstanceLocation(instance);
                    const parsedLocation = parseLocation(location);
                    const users = getInstanceUsers(instance);
                    return (
                        <div
                            key={`${location || getInstanceTitle(instance)}:${index}`}
                            className="w-full"
                        >
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                {location ? (
                                    <span className="text-muted-foreground min-w-0 truncate text-xs">
                                        <LocationWorld
                                            locationObject={{
                                                ...instance,
                                                ...(instance.ref || {}),
                                                tag: location,
                                                location
                                            }}
                                            currentUserId={currentUserId}
                                            worldDialogShortName={
                                                parsedLocation.shortName || ''
                                            }
                                            grouphint={
                                                instance.groupName ||
                                                instance.group?.name ||
                                                ''
                                            }
                                            instanceOwner={getInstanceOwnerId(
                                                instance
                                            )}
                                            instanceOwnerName={getInstanceOwnerName(
                                                instance
                                            )}
                                            playerCount={
                                                instance.playerCount ??
                                                instance.userCount ??
                                                instance.occupants ??
                                                users.length
                                            }
                                            capacity={
                                                instance.capacity ??
                                                instance.ref?.capacity ??
                                                undefined
                                            }
                                            hint={getInstanceTitle(instance)}
                                        />
                                    </span>
                                ) : null}
                                {location ? (
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={"Launch instance"}
                                        onClick={() => void launch(location)}
                                    >
                                        <PlayIcon data-icon="inline-start" />
                                    </Button>
                                ) : null}
                            </div>
                            {users.length ? (
                                <div className="mt-1 flex flex-wrap items-start">
                                    {users.map((user, userIndex) => (
                                        <Button
                                            key={`${user?.id || user?.userId || user?.displayName || 'user'}:${userIndex}`}
                                            type="button"
                                            variant="ghost"
                                            className="box-border h-auto w-44 justify-start p-1.5 text-left text-sm"
                                            onClick={() => {
                                                const userId =
                                                    user?.id ||
                                                    user?.userId ||
                                                    user?.user_id ||
                                                    user?.user?.id ||
                                                    user?.user?.userId;
                                                if (userId) {
                                                    openUserDialog({
                                                        userId,
                                                        title:
                                                            user?.displayName ||
                                                            user?.user
                                                                ?.displayName ||
                                                            undefined,
                                                        seedData:
                                                            user?.user || user
                                                    });
                                                }
                                            }}
                                        >
                                            <img
                                                src={userImage(
                                                    user,
                                                    true,
                                                    '64'
                                                )}
                                                alt=""
                                                className="mr-2.5 size-9 shrink-0 rounded-full object-cover"
                                            />
                                            <span className="min-w-0 flex-1 overflow-hidden">
                                                <span className="block truncate leading-5 font-medium">
                                                    {user?.displayName ||
                                                        user?.display_name ||
                                                        user?.username ||
                                                        user?.user
                                                            ?.displayName ||
                                                        user?.user?.username ||
                                                        'User'}
                                                </span>
                                                <span className="text-muted-foreground block truncate text-xs">
                                                    {user?.location ===
                                                    'traveling'
                                                        ? 'traveling'
                                                        : user?.status ||
                                                          user?.user?.status ||
                                                          ''}
                                                </span>
                                            </span>
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </EntityInfoBlock>
    );
}

const moderationTabs = [
    { value: 'members', label: appI18n.t('dialog.group.moderation_tabs.members') },
    { value: 'bans', label: appI18n.t('dialog.group.moderation_tabs.bans') },
    { value: 'invites', label: appI18n.t('dialog.group.moderation_tabs.invites') },
    { value: 'requests', label: appI18n.t('dialog.group.moderation_tabs.join_requests') },
    { value: 'blocked', label: appI18n.t('dialog.group.moderation_tabs.blocked_requests') },
    { value: 'logs', label: appI18n.t('dialog.group.moderation_tabs.logs') }
];

function moderationRowUserId(row) {
    return (
        row?.userId || row?.targetUserId || row?.user?.id || row?.actorId || ''
    );
}

function moderationRowLabel(row) {
    if (!row || typeof row !== 'object') {
        return String(row ?? '—');
    }
    return (
        row?.user?.displayName ||
        row?.displayName ||
        row?.targetDisplayName ||
        row?.actorDisplayName ||
        row?.userId ||
        row?.targetUserId ||
        row?.actorId ||
        row?.id ||
        '—'
    );
}

function moderationRowSubtitle(row) {
    return [
        row?.roleIds?.length ? row.roleIds.join(', ') : '',
        row?.action ||
            row?.eventType ||
            row?.type ||
            row?.membershipStatus ||
            '',
        row?.createdAt || row?.updatedAt || row?.joinedAt || ''
    ]
        .filter(Boolean)
        .join(' | ');
}

function moderationRowRoles(row, group) {
    const roles = roleNameMap(group);
    const roleIds = Array.isArray(row?.roleIds)
        ? row.roleIds
        : Array.isArray(row?.user?.roleIds)
          ? row.user.roleIds
          : [];
    return roleIds
        .map((roleId) => roles.get(roleId) || 'Role')
        .filter(Boolean)
        .join(', ');
}

function moderationRowStatus(row) {
    return (
        row?.action ||
        row?.eventType ||
        row?.type ||
        row?.membershipStatus ||
        row?.visibility ||
        '—'
    );
}

function moderationRowDate(row) {
    return (
        row?.createdAt ||
        row?.created_at ||
        row?.updatedAt ||
        row?.updated_at ||
        row?.joinedAt ||
        row?.joined_at ||
        ''
    );
}

function moderationRowSearchText(row, group) {
    return [
        moderationRowLabel(row),
        moderationRowUserId(row),
        moderationRowRoles(row, group),
        moderationRowStatus(row),
        moderationRowDate(row),
        row?.description,
        row?.note,
        row?.managerNotes
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function GroupModerationToolsDialog({ open, onOpenChange, group, endpoint }) {
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('members');
    const [rowsByTab, setRowsByTab] = useState({});
    const [statusByTab, setStatusByTab] = useState({});
    const [errorsByTab, setErrorsByTab] = useState({});
    const [search, setSearch] = useState('');
    const [pageSize, setPageSize] = useState(25);
    const [pageIndex, setPageIndex] = useState(0);
    const [reloadToken, setReloadToken] = useState(0);
    const [actionKey, setActionKey] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        setActiveTab('members');
        setRowsByTab({});
        setStatusByTab({});
        setErrorsByTab({});
        setSearch('');
        setPageIndex(0);
        setActionKey('');
    }, [endpoint, group.id, open]);

    useEffect(() => {
        setSearch('');
        setPageIndex(0);
    }, [activeTab]);

    useEffect(() => {
        if (!open) {
            return;
        }

        let active = true;
        setStatusByTab((current) => ({ ...current, [activeTab]: 'running' }));
        setErrorsByTab((current) => ({ ...current, [activeTab]: '' }));

        const request =
            activeTab === 'members'
                ? groupProfileRepository.getAllGroupMembers({
                      groupId: group.id,
                      endpoint
                  })
                : activeTab === 'bans'
                  ? groupProfileRepository.getAllGroupBans({
                        groupId: group.id,
                        endpoint
                    })
                  : activeTab === 'invites'
                    ? groupProfileRepository.getAllGroupInvites({
                          groupId: group.id,
                          endpoint
                      })
                    : activeTab === 'requests'
                      ? groupProfileRepository.getAllGroupJoinRequests({
                            groupId: group.id,
                            endpoint,
                            blocked: false
                        })
                      : activeTab === 'blocked'
                        ? groupProfileRepository.getAllGroupJoinRequests({
                              groupId: group.id,
                              endpoint,
                              blocked: true
                          })
                        : groupProfileRepository.getAllGroupLogs({
                              groupId: group.id,
                              endpoint
                          });

        request
            .then((rows) => {
                if (!active) {
                    return;
                }
                setRowsByTab((current) => ({
                    ...current,
                    [activeTab]: Array.isArray(rows) ? rows : []
                }));
                setStatusByTab((current) => ({
                    ...current,
                    [activeTab]: 'ready'
                }));
            })
            .catch((error) => {
                if (!active) {
                    return;
                }
                setStatusByTab((current) => ({
                    ...current,
                    [activeTab]: 'error'
                }));
                setErrorsByTab((current) => ({
                    ...current,
                    [activeTab]:
                        error instanceof Error
                            ? error.message
                            : 'Failed to load moderation data.'
                }));
            });

        return () => {
            active = false;
        };
    }, [activeTab, endpoint, group.id, open, reloadToken]);

    const rows = rowsByTab[activeTab] || [];
    const loading = statusByTab[activeTab] === 'running';
    const error = errorsByTab[activeTab] || '';
    const filteredRows = rows.filter((row) => {
        const query = search.trim().toLowerCase();
        return !query || moderationRowSearchText(row, group).includes(query);
    });
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );

    function moderationActions(row) {
        const userId = moderationRowUserId(row);
        if (!userId) {
            return [];
        }
        if (activeTab === 'members') {
            return [
                { key: 'kick', label: appI18n.t('dialog.group.moderation_tabs.kick'), destructive: true },
                { key: 'ban', label: appI18n.t('dialog.group.moderation_tabs.ban'), destructive: true }
            ];
        }
        if (activeTab === 'bans') {
            return [{ key: 'unban', label: appI18n.t('dialog.group.moderation_tabs.unban') }];
        }
        if (activeTab === 'invites') {
            return [
                { key: 'delete-invite', label: appI18n.t('dialog.group.moderation_tabs.delete'), destructive: true }
            ];
        }
        if (activeTab === 'requests') {
            return [
                { key: 'accept-request', label: appI18n.t('dialog.group.moderation_tabs.accept') },
                { key: 'reject-request', label: appI18n.t('dialog.group.moderation_tabs.reject'), destructive: true },
                { key: 'block-request', label: appI18n.t('dialog.group.moderation_tabs.block'), destructive: true }
            ];
        }
        if (activeTab === 'blocked') {
            return [
                { key: 'delete-blocked', label: appI18n.t('dialog.group.moderation_tabs.delete'), destructive: true }
            ];
        }
        return [];
    }

    async function runModerationAction(action, row) {
        const userId = moderationRowUserId(row);
        if (!userId || actionKey) {
            return;
        }
        const label = moderationRowLabel(row);
        const result = await confirm({
            title: appI18n.t('dialog.group.generated_dynamic.value_group_user', { value: action.label }),
            description: label,
            confirmText: action.label,
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: Boolean(action.destructive)
        });
        if (!result.ok) {
            return;
        }

        const nextActionKey = `${activeTab}:${action.key}:${userId}`;
        setActionKey(nextActionKey);
        try {
            if (action.key === 'kick') {
                await groupProfileRepository.kickGroupMember({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            } else if (action.key === 'ban') {
                await groupProfileRepository.banGroupMember({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            } else if (action.key === 'unban') {
                await groupProfileRepository.unbanGroupMember({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            } else if (action.key === 'delete-invite') {
                await groupProfileRepository.deleteSentGroupInvite({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            } else if (action.key === 'accept-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'accept',
                    endpoint
                });
            } else if (action.key === 'reject-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'reject',
                    endpoint
                });
            } else if (action.key === 'block-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'reject',
                    block: true,
                    endpoint
                });
            } else if (action.key === 'delete-blocked') {
                await groupProfileRepository.deleteBlockedGroupRequest({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            }
            setRowsByTab((current) => ({
                [activeTab]: (current[activeTab] || []).filter(
                    (item) => moderationRowUserId(item) !== userId
                )
            }));
            setStatusByTab({
                [activeTab]: 'ready'
            });
            setErrorsByTab({});
            toast.success(appI18n.t('dialog.group.generated_dynamic.value_completed', { value: action.label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.group.generated_toast.value_failed', { value: action.label })
            );
        } finally {
            setActionKey('');
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,64rem)]">
                <DialogHeader>
                    <DialogTitle>{appI18n.t('dialog.group.generated.moderation_tools')}</DialogTitle>
                    <DialogDescription>
                        {group.name || 'Group'}
                    </DialogDescription>
                </DialogHeader>
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="min-h-0 gap-0"
                >
                    <TabsList
                        variant="line"
                        className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1"
                    >
                        {moderationTabs.map((tab) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className="flex-none rounded-none px-3"
                            >
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {moderationTabs.map((tab) => (
                        <TabsContent
                            key={tab.value}
                            value={tab.value}
                            className="m-0 max-h-[65vh] overflow-auto pt-4"
                        >
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={loading}
                                        onClick={() =>
                                            setReloadToken((value) => value + 1)
                                        }
                                    >
                                        <RefreshCwIcon data-icon="inline-start" />
                                        {appI18n.t('common.actions.refresh')}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={!rows.length}
                                        onClick={() =>
                                            downloadJsonFile(
                                                `${group.id}_${activeTab}.json`,
                                                rows
                                            )
                                        }
                                    >
                                        <DownloadIcon data-icon="inline-start" />
                                        JSON
                                    </Button>
                                    <span className="text-muted-foreground text-sm">
                                        {filteredRows.length}/{rows.length}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={search}
                                        onChange={(event) => {
                                            setSearch(event.target.value);
                                            setPageIndex(0);
                                        }}
                                        placeholder={appI18n.t('dialog.group.generated_dynamic.search_value', { value: tab.label.toLowerCase() })}
                                        className="h-8 w-64"
                                    />
                                    <Select
                                        value={String(pageSize)}
                                        onValueChange={(value) => {
                                            setPageSize(
                                                Number.parseInt(value, 10) || 25
                                            );
                                            setPageIndex(0);
                                        }}
                                    >
                                        <SelectTrigger
                                            size="sm"
                                            className="w-24"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {[10, 25, 50, 100].map(
                                                    (size) => (
                                                        <SelectItem
                                                            key={size}
                                                            value={String(size)}
                                                        >
                                                            {size}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {loading ? (
                                <GroupListState
                                    title={appI18n.t('dialog.group.generated_dynamic.no_value', { value: tab.label.toLowerCase() })}
                                    loading
                                />
                            ) : null}
                            {error ? (
                                <GroupListState
                                    title={appI18n.t('dialog.group.generated_dynamic.no_value', { value: tab.label.toLowerCase() })}
                                    error={error}
                                />
                            ) : null}
                            {!loading && !error ? (
                                <div className="overflow-auto rounded-md border">
                                    <Table>
                                        <TableHeader className="bg-background sticky top-0">
                                            <TableRow>
                                                <TableHead className="w-56">
                                                    {appI18n.t('dialog.group.generated.user')}
                                                </TableHead>
                                                <TableHead>
                                                    {appI18n.t('dialog.group.generated.roles_description')}
                                                </TableHead>
                                                <TableHead className="w-44">
                                                    {appI18n.t('dialog.group.generated.status')}
                                                </TableHead>
                                                <TableHead className="w-44">
                                                    {appI18n.t('dialog.group.generated.date')}
                                                </TableHead>
                                                <TableHead className="w-48 text-right">
                                                    {appI18n.t('dialog.group.generated.actions')}
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {visibleRows.length ? (
                                                visibleRows.map(
                                                    (row, index) => {
                                                        const userId =
                                                            moderationRowUserId(
                                                                row
                                                            );
                                                        const label =
                                                            moderationRowLabel(
                                                                row
                                                            );
                                                        const date =
                                                            moderationRowDate(
                                                                row
                                                            );
                                                        const actions =
                                                            moderationActions(
                                                                row
                                                            );
                                                        return (
                                                            <TableRow
                                                                key={`${label}:${date}:${index}`}
                                                            >
                                                                <TableCell className="align-top">
                                                                    {userId ? (
                                                                        <Button
                                                                            type="button"
                                                                            variant="ghost"
                                                                            className="hover:text-primary h-auto max-w-52 justify-start truncate p-0 text-left font-medium"
                                                                            onClick={() =>
                                                                                openUserDialog(
                                                                                    {
                                                                                        userId,
                                                                                        title: label,
                                                                                        seedData:
                                                                                            row?.user ||
                                                                                            null
                                                                                    }
                                                                                )
                                                                            }
                                                                        >
                                                                            {
                                                                                label
                                                                            }
                                                                        </Button>
                                                                    ) : (
                                                                        <span className="font-medium">
                                                                            {
                                                                                label
                                                                            }
                                                                        </span>
                                                                    )}
                                                                    <div className="text-muted-foreground truncate font-mono text-xs">
                                                                        {userId ||
                                                                            row?.id ||
                                                                            '—'}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-muted-foreground align-top text-xs whitespace-normal">
                                                                    {moderationRowRoles(
                                                                        row,
                                                                        group
                                                                    ) ||
                                                                        row?.description ||
                                                                        row?.note ||
                                                                        row?.managerNotes ||
                                                                        moderationRowSubtitle(
                                                                            row
                                                                        ) ||
                                                                        '—'}
                                                                </TableCell>
                                                                <TableCell className="align-top text-xs whitespace-normal">
                                                                    {moderationRowStatus(
                                                                        row
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className="text-muted-foreground align-top text-xs">
                                                                    {date
                                                                        ? formatDateFilter(
                                                                              date,
                                                                              'long'
                                                                          )
                                                                        : '—'}
                                                                </TableCell>
                                                                <TableCell className="align-top">
                                                                    <div className="flex justify-end gap-2">
                                                                        {actions.map(
                                                                            (
                                                                                action
                                                                            ) => {
                                                                                const nextActionKey = `${activeTab}:${action.key}:${userId}`;
                                                                                return (
                                                                                    <Button
                                                                                        key={
                                                                                            action.key
                                                                                        }
                                                                                        type="button"
                                                                                        size="sm"
                                                                                        variant={
                                                                                            action.destructive
                                                                                                ? 'outline'
                                                                                                : 'secondary'
                                                                                        }
                                                                                        disabled={Boolean(
                                                                                            actionKey
                                                                                        )}
                                                                                        onClick={() =>
                                                                                            void runModerationAction(
                                                                                                action,
                                                                                                row
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        {actionKey ===
                                                                                        nextActionKey
                                                                                            ? '...'
                                                                                            : action.label}
                                                                                    </Button>
                                                                                );
                                                                            }
                                                                        )}
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    }
                                                )
                                            ) : (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={5}
                                                        className="text-muted-foreground py-8 text-center text-sm"
                                                    >
                                                        {appI18n.t('dialog.group.generated.no_rows')}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            ) : null}
                            {!loading && !error ? (
                                <div className="mt-3 flex items-center justify-between">
                                    <span className="text-muted-foreground text-sm">
                                        {appI18n.t('dialog.group.generated.page')} {currentPageIndex + 1} /{' '}
                                        {totalPages}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={currentPageIndex <= 0}
                                            onClick={() =>
                                                setPageIndex((value) =>
                                                    Math.max(0, value - 1)
                                                )
                                            }
                                        >
                                            {appI18n.t('table.pagination.previous')}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                currentPageIndex >=
                                                totalPages - 1
                                            }
                                            onClick={() =>
                                                setPageIndex((value) =>
                                                    Math.min(
                                                        totalPages - 1,
                                                        value + 1
                                                    )
                                                )
                                            }
                                        >
                                            {appI18n.t('table.pagination.next')}
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </TabsContent>
                    ))}
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

export function GroupPostEditorDialog({
    open,
    onOpenChange,
    form,
    onFormChange,
    group,
    endpoint = '',
    submitting = false,
    onSubmit
}) {
    const [galleryRows, setGalleryRows] = useState([]);
    const [galleryStatus, setGalleryStatus] = useState('idle');
    const [galleryError, setGalleryError] = useState('');
    const galleryRequestIdRef = useRef(0);

    async function loadGalleryRows() {
        if (!open) {
            return;
        }
        const requestId = galleryRequestIdRef.current + 1;
        galleryRequestIdRef.current = requestId;
        setGalleryStatus('running');
        setGalleryError('');
        try {
            const response = await mediaRepository.getFileList(
                { n: 100, tag: 'gallery' },
                { endpoint }
            );
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows(
                Array.isArray(response.json) ? [...response.json].reverse() : []
            );
            setGalleryStatus('ready');
        } catch (error) {
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows([]);
            setGalleryStatus('error');
            setGalleryError(
                error instanceof Error
                    ? error.message
                    : 'Failed to load gallery images.'
            );
        }
    }

    useEffect(() => {
        if (open) {
            void loadGalleryRows();
        } else {
            galleryRequestIdRef.current += 1;
            setGalleryRows([]);
            setGalleryStatus('idle');
            setGalleryError('');
        }
    }, [endpoint, open]);

    if (!form) {
        return null;
    }
    const roles = Array.isArray(group?.roles) ? group.roles : [];
    const roleIds = Array.isArray(form.roleIds) ? form.roleIds : [];
    const isEdit = form.mode === 'edit';
    const galleryOptions = galleryRows
        .map((row) => ({
            id: row?.id || row?.fileId || row?.file_id || '',
            label: rowLabel(row),
            image: rowImage(row, 'gallery')
        }))
        .filter((option) => option.id);

    function updateForm(patch) {
        onFormChange?.({ ...form, ...patch });
    }

    function toggleRole(roleId, checked) {
        const nextRoleIds = checked
            ? Array.from(new Set([...roleIds, roleId]))
            : roleIds.filter((id) => id !== roleId);
        updateForm({ roleIds: nextRoleIds });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? 'Edit group post' : 'Create group post'}
                    </DialogTitle>
                    <DialogDescription>
                        {group?.name || 'Group'}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup className="gap-4">
                    <Field>
                        <FieldLabel htmlFor="group-post-title">
                            {appI18n.t('dialog.group_post_edit.title')}
                        </FieldLabel>
                        <Input
                            id="group-post-title"
                            value={form.title}
                            onChange={(event) =>
                                updateForm({ title: event.target.value })
                            }
                            disabled={submitting}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="group-post-text">
                            {appI18n.t('dialog.group.generated.message')}
                        </FieldLabel>
                        <Textarea
                            id="group-post-text"
                            rows={4}
                            value={form.text}
                            onChange={(event) =>
                                updateForm({ text: event.target.value })
                            }
                            disabled={submitting}
                            className="resize-none"
                        />
                    </Field>
                    {!isEdit ? (
                        <Field
                            orientation="horizontal"
                            data-disabled={submitting}
                        >
                            <Checkbox
                                id="group-post-send-notification"
                                checked={Boolean(form.sendNotification)}
                                disabled={submitting}
                                onCheckedChange={(checked) =>
                                    updateForm({
                                        sendNotification: checked === true
                                    })
                                }
                            />
                            <FieldLabel htmlFor="group-post-send-notification">
                                {appI18n.t('dialog.group.generated.send_notification')}
                            </FieldLabel>
                        </Field>
                    ) : null}
                    <Field>
                        <FieldLabel>{appI18n.t('dialog.group.generated.post_visibility')}</FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            value={form.visibility}
                            onValueChange={(visibility) => {
                                if (visibility) {
                                    updateForm({ visibility });
                                }
                            }}
                            disabled={submitting}
                        >
                            {['public', 'group'].map((visibility) => (
                                <ToggleGroupItem
                                    key={visibility}
                                    value={visibility}
                                >
                                    {visibility === 'public'
                                        ? 'Public'
                                        : 'Group'}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                    {form.visibility === 'group' ? (
                        <Field>
                            <FieldLabel>{appI18n.t('dialog.group.generated.roles')}</FieldLabel>
                            {roles.length ? (
                                <FieldGroup
                                    data-slot="checkbox-group"
                                    className="grid max-h-48 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2"
                                >
                                    {roles.map((role) => (
                                        <Field
                                            key={role.id || role.name}
                                            orientation="horizontal"
                                            data-disabled={
                                                submitting || !role.id
                                            }
                                        >
                                            <Checkbox
                                                id={`group-post-role-${role.id || role.name}`}
                                                checked={roleIds.includes(
                                                    role.id
                                                )}
                                                disabled={
                                                    submitting || !role.id
                                                }
                                                onCheckedChange={(checked) =>
                                                    toggleRole(
                                                        role.id,
                                                        checked === true
                                                    )
                                                }
                                            />
                                            <FieldLabel
                                                htmlFor={`group-post-role-${role.id || role.name}`}
                                                className="min-w-0 truncate"
                                            >
                                                {role.name || role.id}
                                            </FieldLabel>
                                        </Field>
                                    ))}
                                </FieldGroup>
                            ) : (
                                <GroupListState
                                    title={appI18n.t('dialog.group.generated.no_roles')}
                                    description=""
                                    className="min-h-20 p-3"
                                />
                            )}
                        </Field>
                    ) : null}
                    <Field>
                        <FieldLabel htmlFor="group-post-image-id">
                            {appI18n.t('dialog.group.generated.image')}
                        </FieldLabel>
                        <InputGroup>
                            <InputGroupInput
                                id="group-post-image-id"
                                value={form.imageId || ''}
                                onChange={(event) =>
                                    updateForm({ imageId: event.target.value })
                                }
                                disabled={submitting}
                                placeholder={appI18n.t('dialog.group.generated.gallery_image_id')}
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    type="button"
                                    disabled={submitting || !form.imageId}
                                    onClick={() => updateForm({ imageId: '' })}
                                >
                                    {appI18n.t('common.actions.clear')}
                                </InputGroupButton>
                                <InputGroupButton
                                    type="button"
                                    disabled={
                                        submitting ||
                                        galleryStatus === 'running'
                                    }
                                    onClick={() => void loadGalleryRows()}
                                >
                                    {appI18n.t('common.actions.refresh')}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                        {galleryOptions.length ? (
                            <div className="grid max-h-56 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2">
                                {galleryOptions.map((option) => (
                                    <Button
                                        key={option.id}
                                        type="button"
                                        variant="outline"
                                        disabled={submitting}
                                        className={cn(
                                            'h-auto w-full min-w-0 justify-start gap-2 p-2 text-left text-sm',
                                            form.imageId === option.id &&
                                                'border-primary'
                                        )}
                                        onClick={() =>
                                            updateForm({ imageId: option.id })
                                        }
                                    >
                                        {option.image ? (
                                            <img
                                                src={option.image}
                                                alt=""
                                                className="size-12 shrink-0 rounded object-cover"
                                            />
                                        ) : (
                                            <span className="text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded border">
                                                <ImageIcon />
                                            </span>
                                        )}
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium">
                                                {option.label}
                                            </span>
                                            <span className="text-muted-foreground block truncate font-mono text-xs">
                                                {option.id}
                                            </span>
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        ) : (
                            <GroupListState
                                title={appI18n.t('dialog.group.generated.no_gallery_images')}
                                description={appI18n.t('dialog.group.generated.refresh_to_load_gallery_images')}
                                loading={galleryStatus === 'running'}
                                error={galleryError}
                                className="min-h-24 p-3"
                            />
                        )}
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={submitting}
                        onClick={() => onOpenChange?.(false)}
                    >
                        {appI18n.t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={submitting}
                        onClick={() => onSubmit?.(form)}
                    >
                        {isEdit ? 'Edit Post' : 'Create Post'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
