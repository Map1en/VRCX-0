import { useEffect, useRef, useState } from 'react';
import {
    BadgeCheckIcon,
    BellIcon,
    BellOffIcon,
    CopyIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    ImageIcon,
    LogInIcon,
    LogOutIcon,
    MessageSquareIcon,
    PencilIcon,
    PlayIcon,
    RefreshCwIcon,
    Share2Icon,
    SettingsIcon,
    ShieldIcon,
    ShieldOffIcon,
    TicketIcon,
    TagIcon,
    Trash2Icon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { formatDateFilter } from '@/lib/dateTime.js';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { convertFileUrlToImageUrl, copyTextToClipboard, openExternalLink, userImage } from '@/lib/entityMedia.js';
import { groupProfileRepository, mediaRepository } from '@/repositories/index.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { languageMappings } from '@/shared/constants/language.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import { Label } from '@/ui/shadcn/label.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityBlank,
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityRawJson
} from './EntityDialogScaffold.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';
import { PreviousInstancesTableDialog } from './PreviousInstancesTableDialog.jsx';

function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
}

function firstText(...values) {
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

function normalizeGroupLanguages(group) {
    const rows = firstArray(group?.$languages).map((entry) => {
        if (typeof entry === 'string') {
            return { key: entry, value: entry };
        }
        return {
            key: entry?.key || entry?.id || entry?.value || '',
            value: entry?.value || entry?.label || entry?.name || entry?.key || ''
        };
    });
    const seen = new Set(rows.map((entry) => String(entry.key || entry.value).toLowerCase()));
    for (const language of firstArray(group?.languages)) {
        const key = String(language || '').trim().toLowerCase();
        if (!key || seen.has(key)) {
            continue;
        }
        rows.push({ key, value: key });
        seen.add(key);
    }
    return rows.filter((entry) => entry.key || entry.value);
}

function rowLabel(row) {
    if (typeof row === 'string') {
        return row;
    }
    if (!row || typeof row !== 'object') {
        return '—';
    }
    const label = row.title || row.user?.displayName || row.displayName || row.name || row.imageUrl || '—';
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

function announcementRoleNames(announcement, group) {
    const rolesById = roleNameMap(group);
    return Array.isArray(announcement?.roleIds)
        ? announcement.roleIds.map((roleId) => rolesById.get(roleId) || roleId).filter(Boolean)
        : [];
}

function announcementTimestamp(value) {
    return value ? formatDateFilter(value, 'long') : '—';
}

function announcementUserLabel(announcement, key) {
    return firstText(
        announcement?.[`${key}DisplayName`],
        announcement?.[`${key}Name`],
        announcement?.[`${key}Username`]
    );
}

function announcementUserId(announcement, key) {
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
    return latestVersion?.file?.url || row.imageUrl || row.thumbnailImageUrl || row.iconUrl || row.fileUrl || row.url || '';
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

function downloadJsonFile(fileName, value) {
    const blob = new Blob([JSON.stringify(value ?? null, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}

function hasGroupPermission(group, permission) {
    const direct = Array.isArray(group?.myMember?.permissions) ? group.myMember.permissions : [];
    if (direct.includes('*') || direct.includes(permission)) {
        return true;
    }
    const roleIds = Array.isArray(group?.myMember?.roleIds) ? group.myMember.roleIds : [];
    return (Array.isArray(group?.roles) ? group.roles : [])
        .filter((role) => roleIds.includes(role?.id))
        .some((role) => Array.isArray(role.permissions) && (role.permissions.includes('*') || role.permissions.includes(permission)));
}

function hasGroupModerationPermission(group) {
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

function PostList({ rows, group, onPreviewImage, canManagePosts, onEditPost, onDeletePost }) {
    const rolesById = roleNameMap(group);
    return (
        <div className="flex flex-wrap items-start">
            {rows.map((post, index) => {
                const image = rowRawImage(post);
                return (
                    <div key={post?.id || `${post?.title || 'post'}:${index}`} className="box-border flex w-full items-center p-1.5 text-[13px]">
                        <div className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate font-medium leading-[18px]">{post?.title || 'Post'}</span>
                            {image ? (
                                <button type="button" className="mr-1.5 inline-block align-top" onClick={() => onPreviewImage?.(image, post?.title || 'Post')}>
                                    <img src={convertFileUrlToImageUrl(image, 128)} alt="" className="size-[60px] rounded-md object-cover" />
                                </button>
                            ) : null}
                            <pre className="inline-block whitespace-pre-wrap align-top text-xs font-[inherit] text-muted-foreground">{post?.text || '—'}</pre>
                            <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5 text-xs text-muted-foreground">
                                {Array.isArray(post?.roleIds) && post.roleIds.length ? (
                                    <span className="inline-flex items-center gap-1">
                                        <EyeIcon className="size-3.5" />
                                        {post.roleIds.map((roleId) => rolesById.get(roleId) || 'Role').join(', ')}
                                    </span>
                                ) : null}
                                {post?.authorDisplayName ? <span>{post.authorDisplayName}</span> : null}
                                {post?.editorDisplayName ? <span>edited by {post.editorDisplayName}</span> : null}
                                {post?.updatedAt ? <span>{formatDateFilter(post.updatedAt, 'long')}</span> : null}
                                {canManagePosts ? (
                                    <>
                                        <Button type="button" size="icon-sm" variant="ghost" className="size-6" onClick={() => onEditPost?.(post)}>
                                            <PencilIcon className="size-4" />
                                        </Button>
                                        <Button type="button" size="icon-sm" variant="ghost" className="size-6" onClick={() => onDeletePost?.(post)}>
                                            <Trash2Icon className="size-4" />
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
        const galleryId = row?.$galleryId || row?.galleryId || row?.gallery_id || row?.$galleryName || 'Gallery';
        if (!groups.has(galleryId)) {
            groups.set(galleryId, { gallery: { id: galleryId, name: row?.$galleryName || 'Gallery' }, rows: [] });
        }
        groups.get(galleryId).rows.push(row);
    }
    const galleryEntries = Array.from(groups.values());
    const [activeGallery, setActiveGallery] = useState(galleryEntries[0]?.gallery?.id || '');

    useEffect(() => {
        if (galleryEntries.length && !galleryEntries.some((entry) => entry.gallery.id === activeGallery)) {
            setActiveGallery(galleryEntries[0].gallery.id);
        }
    }, [activeGallery, galleryEntries]);

    if (loading) {
        return <EntityBlank>Loading...</EntityBlank>;
    }
    if (error) {
        return <EntityBlank>{error}</EntityBlank>;
    }
    if (!galleryEntries.length) {
        return <EntityBlank />;
    }

    return (
        <Tabs value={activeGallery} onValueChange={setActiveGallery} className="gap-2">
            <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1">
                {galleryEntries.map(({ gallery, rows: galleryRows }) => (
                    <TabsTrigger key={gallery.id} value={gallery.id} className="flex-none rounded-none px-3">
                        <span className="font-bold">{gallery.name || 'Gallery'}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{galleryRows.length}</span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {galleryEntries.map(({ gallery, rows: galleryRows }) => (
                <TabsContent key={gallery.id} value={gallery.id} className="m-0">
                    {gallery.description ? <div className="px-2 py-1 text-sm text-muted-foreground">{gallery.description}</div> : null}
                    <div className="grid max-h-[600px] gap-4 overflow-y-auto pt-2 sm:grid-cols-2 lg:grid-cols-3">
                        {galleryRows.map((row, index) => {
                            const image = rowImage(row, 'photos');
                            return (
                                <button
                                    key={`${rowLabel(row)}:${index}`}
                                    type="button"
                                    className="overflow-hidden rounded-md border text-left text-sm hover:bg-muted/50"
                                    onClick={() => onPreviewImage?.(rowRawImage(row), rowLabel(row))}>
                                    {image ? (
                                        <img src={image} alt={rowLabel(row)} className="max-h-[200px] w-full object-contain" />
                                    ) : (
                                        <div className="flex h-[200px] w-full items-center justify-center bg-muted">
                                            <ImageIcon className="size-6 text-muted-foreground" />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </TabsContent>
            ))}
        </Tabs>
    );
}

function RowList({ rows, group = null, kind = '', loading = false, error = '', onPreviewImage, canManagePosts = false, onEditPost, onDeletePost }) {
    if (loading) {
        return <EntityBlank>Loading...</EntityBlank>;
    }
    if (error) {
        return <EntityBlank>{error}</EntityBlank>;
    }
    if (kind === 'photos') {
        return <PhotoGalleryRows rows={rows} group={group} loading={loading} error={error} onPreviewImage={onPreviewImage} />;
    }
    if (!rows.length) {
        return <EntityBlank />;
    }
    if (kind === 'posts') {
        return <PostList rows={rows} group={group} onPreviewImage={onPreviewImage} canManagePosts={canManagePosts} onEditPost={onEditPost} onDeletePost={onDeletePost} />;
    }

    return (
        <div className="flex flex-wrap items-start">
            {rows.map((row, index) => {
                const label = rowLabel(row);
                const image = rowImage(row, kind);
                const memberUserId = row?.userId || row?.user?.id;
                const rolesById = roleNameMap(group);
                const memberRoles = Array.isArray(row?.roleIds)
                    ? row.roleIds.map((roleId) => rolesById.get(roleId) || 'Role').filter(Boolean)
                    : [];
                const subtitle = memberRoles.join(', ') ||
                    row?.user?.displayName || row?.displayName || '';
                return (
                    <button
                        key={`${label}:${index}`}
                        type="button"
                        className="box-border flex w-[167px] cursor-pointer items-center p-1.5 text-left text-[13px] hover:rounded-[25px_5px_5px_25px] hover:bg-muted/50"
                        onClick={() => {
                            if (kind === 'members' && memberUserId) {
                                openUserDialog({ userId: memberUserId, title: row?.user?.displayName || undefined, seedData: row?.user || null });
                            }
                        }}>
                        {image ? (
                            <img src={image} alt="" className="mr-2.5 size-9 shrink-0 rounded-full object-cover" />
                        ) : (
                            <div className="mr-2.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                                <UserIcon className="size-4 text-muted-foreground" />
                            </div>
                        )}
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block truncate font-medium leading-[18px]">{label}</span>
                            {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
                            {kind === 'members' ? (
                                <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                    {row?.isRepresenting ? <TagIcon className="size-3.5" /> : null}
                                    {row?.visibility && row.visibility !== 'visible' ? <EyeIcon className="size-3.5" /> : null}
                                    {row?.isSubscribedToAnnouncements === false ? <MessageSquareIcon className="size-3.5" /> : null}
                                    {row?.managerNotes ? <PencilIcon className="size-3.5" /> : null}
                                </span>
                            ) : null}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function getInstanceLocation(instance) {
    const directLocation = instance?.location || instance?.tag || instance?.$location?.tag;
    if (directLocation) {
        return directLocation;
    }
    const worldId = instance?.worldId || instance?.world?.id;
    const instanceId = instance?.instanceId || instance?.id || instance?.name;
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function getInstanceWorldId(instance) {
    const directWorldId = instance?.worldId || instance?.world?.id;
    if (directWorldId) {
        return directWorldId;
    }
    return parseLocation(getInstanceLocation(instance)).worldId || '';
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

function GroupInstanceRows({ instances, currentUserId, endpoint = '' }) {
    if (!instances.length) {
        return null;
    }

    async function launch(location) {
        if (!location) {
            return;
        }
        try {
            const opened = await tryOpenLaunchLocation(location, parseLocation(location).shortName || '', endpoint);
            if (opened) {
                toast.success('VRChat launch request sent.');
                return;
            }
            openWorldDialog({ worldId: parseLocation(location).worldId || location });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to launch instance.');
        }
    }

    return (
        <EntityInfoBlock label="Instances" full>
            <div className="mt-1 space-y-2">
                {instances.map((instance, index) => {
                    const location = getInstanceLocation(instance);
                    const parsedLocation = parseLocation(location);
                    const users = getInstanceUsers(instance);
                    const worldId = getInstanceWorldId(instance);
                    return (
                        <div key={`${location || getInstanceTitle(instance)}:${index}`} className="w-full">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                <button
                                    type="button"
                                    className="min-w-0 truncate text-left hover:underline"
                                    onClick={() => openWorldDialog({ worldId: worldId || location, title: getInstanceTitle(instance) || undefined })}>
                                    {getInstanceTitle(instance) || 'World'}
                                </button>
                                {location ? (
                                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                                        <LocationWorld
                                            locationObject={{
                                                ...instance,
                                                ...(instance.ref || {}),
                                                tag: location,
                                                location
                                            }}
                                            currentUserId={currentUserId}
                                            worldDialogShortName={parsedLocation.shortName || ''}
                                            grouphint={instance.groupName || instance.group?.name || ''}
                                            instanceOwner={getInstanceOwnerId(instance)}
                                            instanceOwnerName={getInstanceOwnerName(instance)}
                                            playerCount={instance.playerCount ?? instance.userCount ?? instance.occupants ?? users.length}
                                            capacity={instance.capacity ?? instance.ref?.capacity ?? undefined}
                                        />
                                    </span>
                                ) : null}
                                {location ? (
                                    <Button type="button" size="icon-sm" variant="ghost" className="size-6" onClick={() => void launch(location)}>
                                        <PlayIcon className="size-4" />
                                    </Button>
                                ) : null}
                            </div>
                            {users.length ? (
                                <div className="mt-1 flex flex-wrap items-start">
                                    {users.map((user, userIndex) => (
                                        <button
                                            key={`${user?.id || user?.userId || user?.displayName || 'user'}:${userIndex}`}
                                            type="button"
                                            className="box-border flex w-[167px] cursor-pointer items-center p-1.5 text-left text-[13px] hover:rounded-[25px_5px_5px_25px] hover:bg-muted/50"
                                            onClick={() => {
                                                const userId = user?.id || user?.userId || user?.user_id || user?.user?.id || user?.user?.userId;
                                                if (userId) {
                                                    openUserDialog({ userId, title: user?.displayName || user?.user?.displayName || undefined, seedData: user?.user || user });
                                                }
                                            }}>
                                            <img src={userImage(user, true, '64')} alt="" className="mr-2.5 size-9 shrink-0 rounded-full object-cover" />
                                            <span className="min-w-0 flex-1 overflow-hidden">
                                                <span className="block truncate font-medium leading-[18px]">
                                                    {user?.displayName || user?.display_name || user?.username || user?.user?.displayName || user?.user?.username || 'User'}
                                                </span>
                                                <span className="block truncate text-xs text-muted-foreground">{user?.location === 'traveling' ? 'traveling' : user?.status || user?.user?.status || ''}</span>
                                            </span>
                                        </button>
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
    { value: 'members', label: 'Members' },
    { value: 'bans', label: 'Bans' },
    { value: 'invites', label: 'Invites' },
    { value: 'requests', label: 'Join Requests' },
    { value: 'blocked', label: 'Blocked Requests' },
    { value: 'logs', label: 'Logs' }
];

function moderationRowUserId(row) {
    return row?.userId || row?.targetUserId || row?.user?.id || row?.actorId || '';
}

function moderationRowLabel(row) {
    if (!row || typeof row !== 'object') {
        return String(row ?? '—');
    }
    return row?.user?.displayName ||
        row?.displayName ||
        row?.targetDisplayName ||
        row?.actorDisplayName ||
        row?.userId ||
        row?.targetUserId ||
        row?.actorId ||
        row?.id ||
        '—';
}

function moderationRowSubtitle(row) {
    return [
        row?.roleIds?.length ? row.roleIds.join(', ') : '',
        row?.action || row?.eventType || row?.type || row?.membershipStatus || '',
        row?.createdAt || row?.updatedAt || row?.joinedAt || ''
    ].filter(Boolean).join(' | ');
}

function moderationRowRoles(row, group) {
    const roles = roleNameMap(group);
    const roleIds = Array.isArray(row?.roleIds) ? row.roleIds : Array.isArray(row?.user?.roleIds) ? row.user.roleIds : [];
    return roleIds.map((roleId) => roles.get(roleId) || 'Role').filter(Boolean).join(', ');
}

function moderationRowStatus(row) {
    return row?.action || row?.eventType || row?.type || row?.membershipStatus || row?.visibility || '—';
}

function moderationRowDate(row) {
    return row?.createdAt || row?.created_at || row?.updatedAt || row?.updated_at || row?.joinedAt || row?.joined_at || '';
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
    ].filter(Boolean).join(' ').toLowerCase();
}

function GroupModerationToolsDialog({ open, onOpenChange, group, endpoint }) {
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
                ? groupProfileRepository.getAllGroupMembers({ groupId: group.id, endpoint })
                : activeTab === 'bans'
                    ? groupProfileRepository.getAllGroupBans({ groupId: group.id, endpoint })
                    : activeTab === 'invites'
                        ? groupProfileRepository.getAllGroupInvites({ groupId: group.id, endpoint })
                        : activeTab === 'requests'
                            ? groupProfileRepository.getAllGroupJoinRequests({ groupId: group.id, endpoint, blocked: false })
                            : activeTab === 'blocked'
                                ? groupProfileRepository.getAllGroupJoinRequests({ groupId: group.id, endpoint, blocked: true })
                                : groupProfileRepository.getAllGroupLogs({ groupId: group.id, endpoint });

        request
            .then((rows) => {
                if (!active) {
                    return;
                }
                setRowsByTab((current) => ({ ...current, [activeTab]: Array.isArray(rows) ? rows : [] }));
                setStatusByTab((current) => ({ ...current, [activeTab]: 'ready' }));
            })
            .catch((error) => {
                if (!active) {
                    return;
                }
                setStatusByTab((current) => ({ ...current, [activeTab]: 'error' }));
                setErrorsByTab((current) => ({
                    ...current,
                    [activeTab]: error instanceof Error ? error.message : 'Failed to load moderation data.'
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
    const visibleRows = filteredRows.slice(currentPageIndex * pageSize, currentPageIndex * pageSize + pageSize);

    function moderationActions(row) {
        const userId = moderationRowUserId(row);
        if (!userId) {
            return [];
        }
        if (activeTab === 'members') {
            return [
                { key: 'kick', label: 'Kick', destructive: true },
                { key: 'ban', label: 'Ban', destructive: true }
            ];
        }
        if (activeTab === 'bans') {
            return [{ key: 'unban', label: 'Unban' }];
        }
        if (activeTab === 'invites') {
            return [{ key: 'delete-invite', label: 'Delete', destructive: true }];
        }
        if (activeTab === 'requests') {
            return [
                { key: 'accept-request', label: 'Accept' },
                { key: 'reject-request', label: 'Reject', destructive: true },
                { key: 'block-request', label: 'Block', destructive: true }
            ];
        }
        if (activeTab === 'blocked') {
            return [{ key: 'delete-blocked', label: 'Delete', destructive: true }];
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
            title: `${action.label} group user?`,
            description: label,
            confirmText: action.label,
            cancelText: 'Cancel',
            destructive: Boolean(action.destructive)
        });
        if (!result.ok) {
            return;
        }

        const nextActionKey = `${activeTab}:${action.key}:${userId}`;
        setActionKey(nextActionKey);
        try {
            if (action.key === 'kick') {
                await groupProfileRepository.kickGroupMember({ groupId: group.id, userId, endpoint });
            } else if (action.key === 'ban') {
                await groupProfileRepository.banGroupMember({ groupId: group.id, userId, endpoint });
            } else if (action.key === 'unban') {
                await groupProfileRepository.unbanGroupMember({ groupId: group.id, userId, endpoint });
            } else if (action.key === 'delete-invite') {
                await groupProfileRepository.deleteSentGroupInvite({ groupId: group.id, userId, endpoint });
            } else if (action.key === 'accept-request') {
                await groupProfileRepository.respondGroupJoinRequest({ groupId: group.id, userId, action: 'accept', endpoint });
            } else if (action.key === 'reject-request') {
                await groupProfileRepository.respondGroupJoinRequest({ groupId: group.id, userId, action: 'reject', endpoint });
            } else if (action.key === 'block-request') {
                await groupProfileRepository.respondGroupJoinRequest({ groupId: group.id, userId, action: 'reject', block: true, endpoint });
            } else if (action.key === 'delete-blocked') {
                await groupProfileRepository.deleteBlockedGroupRequest({ groupId: group.id, userId, endpoint });
            }
            setRowsByTab((current) => ({
                [activeTab]: (current[activeTab] || []).filter((item) => moderationRowUserId(item) !== userId)
            }));
            setStatusByTab({
                [activeTab]: 'ready'
            });
            setErrorsByTab({});
            toast.success(`${action.label} completed.`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : `${action.label} failed.`);
        } finally {
            setActionKey('');
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,64rem)]">
                <DialogHeader>
                    <DialogTitle>Moderation Tools</DialogTitle>
                    <DialogDescription>{group.name || 'Group'}</DialogDescription>
                </DialogHeader>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 gap-0">
                    <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1">
                        {moderationTabs.map((tab) => (
                            <TabsTrigger key={tab.value} value={tab.value} className="flex-none rounded-none px-3">
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {moderationTabs.map((tab) => (
                        <TabsContent key={tab.value} value={tab.value} className="m-0 max-h-[65vh] overflow-auto pt-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setReloadToken((value) => value + 1)}>
                                        <RefreshCwIcon className="size-3.5" />
                                        Refresh
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={() => downloadJsonFile(`${group.id}_${activeTab}.json`, rows)}>
                                        <DownloadIcon className="size-3.5" />
                                        JSON
                                    </Button>
                                    <span className="text-sm text-muted-foreground">{filteredRows.length}/{rows.length}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={search}
                                        onChange={(event) => {
                                            setSearch(event.target.value);
                                            setPageIndex(0);
                                        }}
                                        placeholder={`Search ${tab.label.toLowerCase()}`}
                                        className="h-8 w-64"
                                    />
                                    <Select value={String(pageSize)} onValueChange={(value) => {
                                        setPageSize(Number.parseInt(value, 10) || 25);
                                        setPageIndex(0);
                                    }}>
                                        <SelectTrigger size="sm" className="w-24"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {[10, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {loading ? <EntityBlank>Loading...</EntityBlank> : null}
                            {error ? <EntityBlank>{error}</EntityBlank> : null}
                            {!loading && !error ? (
                                <div className="overflow-auto rounded-md border">
                                    <table className="w-full text-left text-sm">
                                        <thead className="sticky top-0 bg-background">
                                            <tr className="border-b">
                                                <th className="w-56 px-3 py-2">User</th>
                                                <th className="px-3 py-2">Roles / Description</th>
                                                <th className="w-44 px-3 py-2">Status</th>
                                                <th className="w-44 px-3 py-2">Date</th>
                                                <th className="w-48 px-3 py-2 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleRows.length ? visibleRows.map((row, index) => {
                                                const userId = moderationRowUserId(row);
                                                const label = moderationRowLabel(row);
                                                const date = moderationRowDate(row);
                                                const actions = moderationActions(row);
                                                return (
                                                    <tr key={`${label}:${date}:${index}`} className="border-b last:border-b-0">
                                                        <td className="px-3 py-2 align-top">
                                                            {userId ? (
                                                                <button
                                                                    type="button"
                                                                    className="max-w-52 truncate text-left font-medium hover:underline"
                                                                    onClick={() => openUserDialog({ userId, title: label, seedData: row?.user || null })}>
                                                                    {label}
                                                                </button>
                                                            ) : (
                                                                <span className="font-medium">{label}</span>
                                                            )}
                                                            <div className="truncate font-mono text-xs text-muted-foreground">{userId || row?.id || '—'}</div>
                                                        </td>
                                                        <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                                                            {moderationRowRoles(row, group) || row?.description || row?.note || row?.managerNotes || moderationRowSubtitle(row) || '—'}
                                                        </td>
                                                        <td className="px-3 py-2 align-top text-xs">{moderationRowStatus(row)}</td>
                                                        <td className="px-3 py-2 align-top text-xs text-muted-foreground">{date ? formatDateFilter(date, 'long') : '—'}</td>
                                                        <td className="px-3 py-2 align-top">
                                                            <div className="flex justify-end gap-2">
                                                                {actions.map((action) => {
                                                                    const nextActionKey = `${activeTab}:${action.key}:${userId}`;
                                                                    return (
                                                                        <Button
                                                                            key={action.key}
                                                                            type="button"
                                                                            size="sm"
                                                                            variant={action.destructive ? 'outline' : 'secondary'}
                                                                            disabled={Boolean(actionKey)}
                                                                            onClick={() => void runModerationAction(action, row)}>
                                                                            {actionKey === nextActionKey ? '...' : action.label}
                                                                        </Button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            }) : (
                                                <tr>
                                                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">No rows.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            ) : null}
                            {!loading && !error ? (
                                <div className="mt-3 flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Page {currentPageIndex + 1} / {totalPages}</span>
                                    <div className="flex gap-2">
                                        <Button type="button" size="sm" variant="outline" disabled={currentPageIndex <= 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>Previous</Button>
                                        <Button type="button" size="sm" variant="outline" disabled={currentPageIndex >= totalPages - 1} onClick={() => setPageIndex((value) => Math.min(totalPages - 1, value + 1))}>Next</Button>
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

function GroupPostEditorDialog({ open, onOpenChange, form, onFormChange, group, endpoint = '', submitting = false, onSubmit }) {
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
            const response = await mediaRepository.getFileList({ n: 100, tag: 'gallery' }, { endpoint });
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows(Array.isArray(response.json) ? [...response.json].reverse() : []);
            setGalleryStatus('ready');
        } catch (error) {
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows([]);
            setGalleryStatus('error');
            setGalleryError(error instanceof Error ? error.message : 'Failed to load gallery images.');
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
                    <DialogTitle>{isEdit ? 'Edit group post' : 'Create group post'}</DialogTitle>
                    <DialogDescription>{group?.name || 'Group'}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="group-post-title">Title</Label>
                        <Input
                            id="group-post-title"
                            value={form.title}
                            onChange={(event) => updateForm({ title: event.target.value })}
                            disabled={submitting}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="group-post-text">Message</Label>
                        <Textarea
                            id="group-post-text"
                            rows={4}
                            value={form.text}
                            onChange={(event) => updateForm({ text: event.target.value })}
                            disabled={submitting}
                            className="resize-none"
                        />
                    </div>
                    {!isEdit ? (
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={Boolean(form.sendNotification)}
                                disabled={submitting}
                                onCheckedChange={(checked) => updateForm({ sendNotification: checked === true })}
                            />
                            <span>Send notification</span>
                        </label>
                    ) : null}
                    <div className="space-y-1.5">
                        <Label>Post visibility</Label>
                        <div className="flex flex-wrap gap-2">
                            {['public', 'group'].map((visibility) => (
                                <Button
                                    key={visibility}
                                    type="button"
                                    size="sm"
                                    variant={form.visibility === visibility ? 'default' : 'outline'}
                                    disabled={submitting}
                                    onClick={() => updateForm({ visibility })}>
                                    {visibility === 'public' ? 'Public' : 'Group'}
                                </Button>
                            ))}
                        </div>
                    </div>
                    {form.visibility === 'group' ? (
                        <div className="space-y-1.5">
                            <Label>Roles</Label>
                            {roles.length ? (
                                <div className="grid max-h-48 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2">
                                    {roles.map((role) => (
                                        <label key={role.id || role.name} className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={roleIds.includes(role.id)}
                                                disabled={submitting || !role.id}
                                                onCheckedChange={(checked) => toggleRole(role.id, checked === true)}
                                            />
                                            <span className="min-w-0 truncate">{role.name || role.id}</span>
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                    No roles.
                                </div>
                            )}
                        </div>
                    ) : null}
                    <div className="space-y-1.5">
                        <Label htmlFor="group-post-image-id">Image</Label>
                        <div className="flex gap-2">
                            <Input
                                id="group-post-image-id"
                                value={form.imageId || ''}
                                onChange={(event) => updateForm({ imageId: event.target.value })}
                                disabled={submitting}
                                placeholder="Gallery image id"
                            />
                            <Button type="button" variant="outline" disabled={submitting || !form.imageId} onClick={() => updateForm({ imageId: '' })}>
                                Clear
                            </Button>
                            <Button type="button" variant="outline" disabled={submitting || galleryStatus === 'running'} onClick={() => void loadGalleryRows()}>
                                Refresh
                            </Button>
                        </div>
                        {galleryOptions.length ? (
                            <div className="grid max-h-56 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2">
                                {galleryOptions.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        disabled={submitting}
                                        className={`flex min-w-0 gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted/50 ${form.imageId === option.id ? 'border-primary' : ''}`}
                                        onClick={() => updateForm({ imageId: option.id })}>
                                        {option.image ? <img src={option.image} alt="" className="size-12 shrink-0 rounded object-cover" /> : <ImageIcon className="size-12 shrink-0 rounded border p-3 text-muted-foreground" />}
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium">{option.label}</span>
                                            <span className="block truncate font-mono text-xs text-muted-foreground">{option.id}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                                {galleryStatus === 'running' ? 'Loading gallery images...' : galleryError || 'No gallery images loaded.'}
                            </div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" disabled={submitting} onClick={() => onOpenChange?.(false)}>Cancel</Button>
                    <Button type="button" disabled={submitting} onClick={() => onSubmit?.(form)}>
                        {isEdit ? 'Edit Post' : 'Create Post'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

let lastGroupDialogTab = 'info';

function resolveGroupDialogTab(tabs, preferred, fallback = 'info') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

export function GroupDialogTabbedView({
    group,
    detail,
    bannerUrl,
    iconUrl,
    actionStatus,
    isMember,
    isBlocked,
    isRepresenting,
    isSubscribedToAnnouncements,
    ownerDisplayName = '',
    memberVisibility,
    memberStatus,
    joinState,
    canJoin,
    activeInstances = [],
    previousInstances = [],
    onPreviousInstancesChange,
    onRefresh,
    onJoin,
    onLeave,
    onCancelRequest,
    onRepresent,
    onSubscribe,
    onVisibility,
    onBlock
}) {
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('info');
    const [remoteData, setRemoteData] = useState({
        posts: [],
        members: [],
        photos: []
    });
    const [remoteStatus, setRemoteStatus] = useState({});
    const [remoteErrors, setRemoteErrors] = useState({});
    const [search, setSearch] = useState({ posts: '', members: '' });
    const [memberSort, setMemberSort] = useState('joinedAt:desc');
    const [memberRoleId, setMemberRoleId] = useState('');
    const [moderationOpen, setModerationOpen] = useState(false);
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [postEditor, setPostEditor] = useState(null);
    const [postEditorSubmitting, setPostEditorSubmitting] = useState(false);
    const gallerySignature = Array.isArray(group.galleries)
        ? group.galleries.map((gallery) => gallery?.id || '').filter(Boolean).join('|')
        : '';
    const loadContextRef = useRef({
        endpoint: currentEndpoint,
        groupId: group.id,
        gallerySignature
    });
    const tabs = [
        { value: 'info', label: 'Info' },
        { value: 'posts', label: 'Posts' },
        { value: 'members', label: 'Members' },
        { value: 'photos', label: 'Photos' },
        { value: 'json', label: 'JSON' }
    ];
    const posts = remoteStatus.posts === 'ready'
        ? remoteData.posts
        : firstArray(group.posts, group.announcement?.id ? [group.announcement] : []);
    const members = remoteStatus.members === 'ready'
        ? remoteData.members
        : firstArray(group.members);
    const photos = remoteStatus.photos === 'ready'
        ? remoteData.photos
        : firstArray(group.gallery, group.photos);
    const isPrivateGroup = group.privacy === 'private';
    const languageRows = normalizeGroupLanguages(group);
    const canSetVisibility = group.privacy === 'default';
    const isGroupOwner = group.ownerId === currentUserId;
    const canManagePosts = isGroupOwner || hasGroupPermission(group, 'group-announcement-manage');
    const canInviteToGroup = isGroupOwner || hasGroupPermission(group, 'group-invites-manage');
    const canModerateGroup = hasGroupModerationPermission(group);
    const filteredPosts = posts.filter((post) => {
        const query = search.posts.trim().toLowerCase();
        if (!query) {
            return true;
        }
        return [post?.title, post?.text, post?.authorId]
            .some((value) => String(value || '').toLowerCase().includes(query));
    });
    const filteredMembers = members.filter((member) => {
        const query = search.members.trim().toLowerCase();
        if (!query) {
            return true;
        }
        return [member?.user?.displayName, member?.displayName, member?.userId, member?.user?.id]
            .some((value) => String(value || '').toLowerCase().includes(query));
    });

    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort: 'joinedAt:desc',
            memberRoleId: ''
        };
        setRemoteData({ posts: [], members: [], photos: [] });
        setRemoteStatus({});
        setRemoteErrors({});
        setSearch({ posts: '', members: '' });
        setMemberSort('joinedAt:desc');
        setMemberRoleId('');
        const nextTab = resolveGroupDialogTab(tabs, lastGroupDialogTab);
        lastGroupDialogTab = nextTab;
        setActiveTab(nextTab);
    }, [currentEndpoint, group.id]);

    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId
        };

        setRemoteData((current) => ({ ...current, photos: [] }));
        setRemoteStatus((current) => {
            if (!current.photos) {
                return current;
            }
            return { ...current, photos: '' };
        });
        if (activeTab === 'photos' && gallerySignature) {
            void loadTab('photos', { force: true });
        }
    }, [currentEndpoint, gallerySignature, group.id]);

    function isCurrentLoadContext(context) {
        return (
            loadContextRef.current.endpoint === context.endpoint &&
            loadContextRef.current.groupId === context.groupId &&
            (context.tab !== 'photos' || loadContextRef.current.gallerySignature === context.gallerySignature) &&
            (context.tab !== 'members' ||
                (loadContextRef.current.memberSort === context.memberSort &&
                    loadContextRef.current.memberRoleId === context.memberRoleId))
        );
    }

    async function loadTab(tab, { force = false } = {}) {
        if (!group.id || (!force && (remoteStatus[tab] === 'running' || remoteStatus[tab] === 'ready'))) {
            return;
        }
        if (!['posts', 'members', 'photos'].includes(tab)) {
            return;
        }

        const loadContext = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId,
            tab
        };
        loadContextRef.current = {
            ...loadContextRef.current,
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId
        };
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        try {
            let rows = [];
            if (tab === 'posts') {
                rows = await groupProfileRepository.getAllGroupPosts({
                    groupId: group.id,
                    endpoint: currentEndpoint
                });
            } else if (tab === 'members') {
                rows = await groupProfileRepository.getGroupMembers({
                    groupId: group.id,
                    endpoint: currentEndpoint,
                    sort: memberSort,
                    roleId: memberRoleId,
                    force
                });
            } else if (tab === 'photos') {
                const galleries = Array.isArray(group.galleries) ? group.galleries : [];
                const galleryResults = await Promise.allSettled(
                    galleries.map(async (gallery) => {
                        if (!gallery?.id) {
                            return [];
                        }
                        const entries = await groupProfileRepository.getAllGroupGallery({
                            groupId: group.id,
                            galleryId: gallery.id,
                            endpoint: currentEndpoint,
                            force
                        });
                        return entries.map((entry) => ({
                            ...entry,
                            $galleryId: gallery.id,
                            $galleryName: gallery.name || gallery.id
                        }));
                    })
                );
                rows = galleryResults
                    .filter((result) => result.status === 'fulfilled')
                    .flatMap((result) => result.value);
            }
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteData((current) => ({ ...current, [tab]: rows }));
            setRemoteStatus((current) => ({ ...current, [tab]: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, [tab]: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                [tab]: error instanceof Error ? error.message : 'Failed to load tab data.'
            }));
        }
    }

    function changeTab(tab) {
        lastGroupDialogTab = resolveGroupDialogTab(tabs, tab);
        setActiveTab(lastGroupDialogTab);
    }

    useEffect(() => {
        void loadTab(activeTab);
    }, [activeTab, currentEndpoint, gallerySignature, group.id, memberRoleId, memberSort]);

    useEffect(() => {
        if (activeTab === 'members') {
            void loadTab('members', { force: true });
        }
    }, [memberRoleId, memberSort]);

    async function loadAllMembers() {
        const loadContext = {
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId,
            tab: 'members'
        };
        loadContextRef.current = {
            ...loadContextRef.current,
            endpoint: currentEndpoint,
            groupId: group.id,
            gallerySignature,
            memberSort,
            memberRoleId
        };
        setRemoteStatus((current) => ({ ...current, members: 'running' }));
        setRemoteErrors((current) => ({ ...current, members: '' }));
        try {
            const rows = await groupProfileRepository.getAllGroupMembers({
                groupId: group.id,
                endpoint: currentEndpoint,
                sort: memberSort,
                roleId: memberRoleId,
                force: true
            });
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteData((current) => ({ ...current, members: rows }));
            setRemoteStatus((current) => ({ ...current, members: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, members: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                members: error instanceof Error ? error.message : 'Failed to load members.'
            }));
        }
    }

    const groupUrl = group.url || (group.id ? `https://vrchat.com/home/group/${group.id}` : '');
    const groupTitle = group.name || 'Group';
    const ownerLabel = ownerDisplayName && ownerDisplayName !== group.ownerId ? ownerDisplayName : '';

    async function copyGroupText(text, label) {
        await copyTextToClipboard(text);
        toast.success(`${label} copied.`);
    }

    function createGroupPost() {
        setPostEditor({
            mode: 'create',
            post: null,
            title: '',
            text: '',
            sendNotification: true,
            visibility: 'group',
            roleIds: [],
            imageId: ''
        });
    }

    async function submitGroupPost(form) {
        if (!form || postEditorSubmitting) {
            return;
        }
        const title = String(form.title || '').trim();
        const text = String(form.text || '').trim();
        if (!title || !text) {
            toast.warning('Title and text are required.');
            return;
        }

        setPostEditorSubmitting(true);
        try {
            const roleIds = form.visibility === 'group' && Array.isArray(form.roleIds) ? form.roleIds : [];
            if (form.mode === 'edit') {
                await groupProfileRepository.editGroupPost({
                    groupId: group.id,
                    postId: form.post?.id,
                    endpoint: currentEndpoint,
                    params: {
                        title,
                        text,
                        visibility: form.visibility || 'group',
                        roleIds,
                        sendNotification: Boolean(form.sendNotification),
                        imageId: form.imageId || null
                    }
                });
            } else {
                await groupProfileRepository.createGroupPost({
                    groupId: group.id,
                    endpoint: currentEndpoint,
                    params: {
                        title,
                        text,
                        sendNotification: Boolean(form.sendNotification),
                        visibility: form.visibility || 'group',
                        roleIds,
                        imageId: form.imageId || null
                    }
                });
            }
            setRemoteStatus((current) => ({ ...current, posts: '' }));
            await loadTab('posts', { force: true });
            lastGroupDialogTab = 'posts';
            setActiveTab('posts');
            setPostEditor(null);
            toast.success(form.mode === 'edit' ? 'Group post updated.' : 'Group post created.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save group post.');
        } finally {
            setPostEditorSubmitting(false);
        }
    }

    async function inviteUserToGroup() {
        const result = await prompt({
            title: 'Invite to group',
            description: 'Enter the VRChat user id to invite.',
            inputValue: '',
            confirmText: 'Invite',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.sendGroupInvite({
                groupId: group.id,
                userId: result.value,
                endpoint: currentEndpoint
            });
            toast.success('Group invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send group invite.');
        }
    }

    function editGroupPost(post) {
        setPostEditor({
            mode: 'edit',
            post,
            title: post?.title || '',
            text: post?.text || '',
            sendNotification: Boolean(post?.sendNotification),
            visibility: post?.visibility || 'group',
            roleIds: Array.isArray(post?.roleIds) ? post.roleIds : [],
            imageId: post?.imageId || ''
        });
    }

    async function deleteGroupPost(post) {
        const result = await confirm({
            title: 'Delete group post?',
            description: post?.title || group.name || 'Group',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.deleteGroupPost({
                groupId: group.id,
                postId: post.id,
                endpoint: currentEndpoint
            });
            setRemoteData((current) => ({
                ...current,
                posts: current.posts.filter((row) => row.id !== post.id)
            }));
            toast.success('Group post deleted.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete group post.');
        }
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={iconUrl}
                imageAlt={group.name || 'Group'}
                imageClassName="size-[120px]"
                imagePlaceholder={<UsersIcon className="size-8 text-muted-foreground" />}
                onImageClick={iconUrl ? () => openImagePreview({ url: iconUrl, title: groupTitle }) : null}
                titlePrefix={isGroupOwner ? <span className="shrink-0">👑</span> : null}
                title={groupTitle}
                onTitleClick={group.name ? () => void copyGroupText(group.name, 'Group name') : undefined}
                subtitle={group.shortCode && group.discriminator ? `${group.shortCode}.${group.discriminator}` : group.url || ''}
                description={group.description}
                detail={detail}
                badges={
                    <>
                        {group.ownerId ? (
                            <button type="button" onClick={() => openUserDialog({
                                userId: group.ownerId,
                                title: ownerLabel || undefined,
                                seedData: ownerLabel
                                    ? { id: group.ownerId, displayName: ownerLabel }
                                    : null
                            })}>
                                <Badge variant="outline"><UserIcon className="mr-1 size-3.5" />{ownerLabel || 'Owner'}</Badge>
                            </button>
                        ) : null}
                        {languageRows.map((language) => (
                            <Badge key={`${language.key}:${language.value}`} variant="outline" title={`${language.value || language.key} (${language.key})`}>
                                {languageMappings[String(language.key).toLowerCase()] ? String(language.key).toUpperCase() : (language.value || language.key)}
                            </Badge>
                        ))}
                        {group.privacy ? <Badge variant="outline"><ShieldIcon className="mr-1 size-3.5" />{group.privacy}</Badge> : null}
                        {group.membershipStatus ? <Badge variant="secondary">{group.membershipStatus}</Badge> : null}
                        {group.isVerified ? <Badge><BadgeCheckIcon className="mr-1 size-3.5" />Verified</Badge> : null}
                        <Badge variant="outline"><UsersIcon className="mr-1 size-3.5" />{group.memberCount} members</Badge>
                        {group.onlineMemberCount > 0 ? <Badge variant="outline"><UsersIcon className="mr-1 size-3.5" />{group.onlineMemberCount} online</Badge> : null}
                    </>
                }
                actions={
                    <>
                        {memberStatus === 'requested' ? (
                            <Button type="button" size="icon-lg" variant="outline" className="rounded-full" disabled={actionStatus === 'cancel-request'} onClick={onCancelRequest}>
                                <XIcon className="size-4" />
                            </Button>
                        ) : !isMember ? (
                            <Button type="button" size="icon-lg" className="rounded-full" disabled={!canJoin || actionStatus === 'join'} onClick={onJoin}>
                                <LogInIcon className="size-4" />
                            </Button>
                        ) : null}
                        <EntityActionDropdown busy={actionStatus !== 'idle'}>
                            <EntityActionItem icon={RefreshCwIcon} disabled={actionStatus === 'refresh'} onSelect={onRefresh}>Refresh</EntityActionItem>
                            {groupUrl ? (
                                <>
                                    <EntityActionItem icon={Share2Icon} onSelect={() => void copyGroupText(groupUrl, 'Group URL')}>Share / Copy URL</EntityActionItem>
                                    <EntityActionItem icon={ExternalLinkIcon} onSelect={() => openExternalLink(groupUrl)}>Open Group Page</EntityActionItem>
                                    <EntityActionItem icon={CopyIcon} onSelect={() => void copyGroupText(group.id, 'Group ID')}>Copy Group ID</EntityActionItem>
                                </>
                            ) : null}
                            {isMember ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem icon={ShieldIcon} disabled={actionStatus === 'represent' || isPrivateGroup} onSelect={() => onRepresent(!isRepresenting)}>
                                        {isRepresenting ? 'Unrepresent Group' : 'Represent Group'}
                                    </EntityActionItem>
                                    <EntityActionItem icon={isSubscribedToAnnouncements ? BellOffIcon : BellIcon} disabled={actionStatus === 'member-props'} onSelect={() => onSubscribe(!isSubscribedToAnnouncements)}>
                                        {isSubscribedToAnnouncements ? 'Unsubscribe Announcements' : 'Subscribe Announcements'}
                                    </EntityActionItem>
                                    {canInviteToGroup ? (
                                        <EntityActionItem icon={MessageSquareIcon} disabled={remoteStatus.members === 'running'} onSelect={() => void inviteUserToGroup()}>
                                            Invite To Group
                                        </EntityActionItem>
                                    ) : null}
                                    {canManagePosts ? (
                                        <EntityActionItem icon={TicketIcon} disabled={remoteStatus.posts === 'running'} onSelect={() => void createGroupPost()}>
                                            Create Post
                                        </EntityActionItem>
                                    ) : null}
                                    {canModerateGroup ? (
                                        <EntityActionItem icon={SettingsIcon} onSelect={() => setModerationOpen(true)}>
                                            Moderation Tools
                                        </EntityActionItem>
                                    ) : null}
                                    {canSetVisibility ? (
                                        <>
                                            <EntityActionSeparator />
                                            <EntityActionItem icon={UserIcon} disabled={actionStatus === 'member-props'} onSelect={() => onVisibility('visible')}>
                                                {memberVisibility === 'visible' ? 'Selected: ' : ''}Visibility Everyone
                                            </EntityActionItem>
                                            <EntityActionItem icon={UserIcon} disabled={actionStatus === 'member-props'} onSelect={() => onVisibility('friends')}>
                                                {memberVisibility === 'friends' ? 'Selected: ' : ''}Visibility Friends
                                            </EntityActionItem>
                                            <EntityActionItem icon={UserIcon} disabled={actionStatus === 'member-props'} onSelect={() => onVisibility('hidden')}>
                                                {memberVisibility === 'hidden' ? 'Selected: ' : ''}Visibility Hidden
                                            </EntityActionItem>
                                        </>
                                    ) : null}
                                    <EntityActionSeparator />
                                    <EntityActionItem icon={LogOutIcon} destructive disabled={actionStatus === 'leave'} onSelect={onLeave}>Leave Group</EntityActionItem>
                                </>
                            ) : (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem icon={isBlocked ? ShieldIcon : ShieldOffIcon} destructive={isBlocked} disabled={actionStatus === 'block'} onSelect={() => onBlock(!isBlocked)}>
                                        {isBlocked ? 'Unblock Group' : 'Block Group'}
                                    </EntityActionItem>
                                </>
                            )}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs value={activeTab} onValueChange={changeTab} tabs={tabs}>
                <EntityDialogTabContent value="info">
                    {bannerUrl ? (
                        <button
                            type="button"
                            className="mb-3 w-full overflow-hidden rounded-md bg-muted"
                            onClick={() => openImagePreview({ url: bannerUrl, title: groupTitle })}>
                            <img src={bannerUrl} alt={group.name || 'Group banner'} className="aspect-[6/1] w-full object-cover" />
                        </button>
                    ) : null}
                    <EntityInfoGrid>
                        <GroupInstanceRows instances={activeInstances} currentUserId={currentUserId} endpoint={currentEndpoint} />
                        {group.announcement?.id || group.announcement?.title ? (
                            <EntityInfoBlock label="Announcement" full>
                                <span className="block truncate text-sm">{group.announcement.title || 'Announcement'}</span>
                                {group.announcement.imageUrl ? (
                                    <button type="button" className="mr-1.5 mt-1.5 inline-block align-top" onClick={() => openImagePreview({ url: convertFileUrlToImageUrl(group.announcement.imageUrl, 1024), title: group.announcement.title || 'Announcement' })}>
                                        <img src={convertFileUrlToImageUrl(group.announcement.imageUrl, 128)} alt="" className="size-[60px] rounded-md object-cover" />
                                    </button>
                                ) : null}
                                <pre className="inline-block whitespace-pre-wrap align-top text-xs font-[inherit] text-muted-foreground">{group.announcement.text || '—'}</pre>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                    {announcementRoleNames(group.announcement, group).length ? (
                                        <span className="inline-flex items-center gap-1" title={announcementRoleNames(group.announcement, group).join(', ')}>
                                            <EyeIcon className="size-3.5" />
                                            <span className="max-w-full truncate">{announcementRoleNames(group.announcement, group).join(', ')}</span>
                                        </span>
                                    ) : null}
                                    {announcementUserId(group.announcement, 'author') || announcementUserLabel(group.announcement, 'author') ? (
                                        announcementUserId(group.announcement, 'author') ? (
                                            <button
                                                type="button"
                                                className="inline-flex items-center gap-1 hover:underline"
                                                onClick={() => openUserDialog({
                                                    userId: announcementUserId(group.announcement, 'author'),
                                                    title: announcementUserLabel(group.announcement, 'author') || undefined
                                                })}>
                                                <span>Author:</span>
                                                <span className="font-medium text-foreground">{announcementUserLabel(group.announcement, 'author') || announcementUserId(group.announcement, 'author')}</span>
                                            </button>
                                        ) : (
                                            <span className="inline-flex items-center gap-1">
                                                <span>Author:</span>
                                                <span className="font-medium text-foreground">{announcementUserLabel(group.announcement, 'author')}</span>
                                            </span>
                                        )
                                    ) : null}
                                    {announcementUserId(group.announcement, 'editor') || announcementUserLabel(group.announcement, 'editor') ? (
                                        announcementUserId(group.announcement, 'editor') ? (
                                            <button
                                                type="button"
                                                className="inline-flex items-center gap-1 hover:underline"
                                                onClick={() => openUserDialog({
                                                    userId: announcementUserId(group.announcement, 'editor'),
                                                    title: announcementUserLabel(group.announcement, 'editor') || undefined
                                                })}>
                                                <span>Edited by:</span>
                                                <span className="font-medium text-foreground">{announcementUserLabel(group.announcement, 'editor') || announcementUserId(group.announcement, 'editor')}</span>
                                            </button>
                                        ) : (
                                            <span className="inline-flex items-center gap-1">
                                                <span>Edited by:</span>
                                                <span className="font-medium text-foreground">{announcementUserLabel(group.announcement, 'editor')}</span>
                                            </span>
                                        )
                                    ) : null}
                                    {group.announcement.createdAt ? (
                                        <span className="inline-flex items-center gap-1">
                                            <span>Created:</span>
                                            <span className="font-medium text-foreground">{announcementTimestamp(group.announcement.createdAt)}</span>
                                        </span>
                                    ) : null}
                                    {group.announcement.updatedAt ? (
                                        <span className="inline-flex items-center gap-1">
                                            <span>Updated:</span>
                                            <span className="font-medium text-foreground">{announcementTimestamp(group.announcement.updatedAt)}</span>
                                        </span>
                                    ) : null}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        {group.rules ? (
                            <EntityInfoBlock label="Rules" full>
                                <pre className="whitespace-pre-wrap text-xs font-[inherit] text-muted-foreground">{group.rules}</pre>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock label="Members" value={`${group.memberCount || 0} (${group.onlineMemberCount || 0})`} />
                        <EntityInfoBlock label="Created At" value={(group.createdAt || group.created_at) ? formatDateFilter(group.createdAt || group.created_at, 'long') : '—'} />
                        <EntityInfoBlock label="Last Visited" value={(previousInstances[0]?.created_at || previousInstances[0]?.createdAt) ? formatDateFilter(previousInstances[0]?.created_at || previousInstances[0]?.createdAt, 'long') : '—'} onClick={previousInstances.length ? () => setPreviousInstancesOpen(true) : undefined} />
                        <EntityInfoBlock label="Join State" value={joinState || '—'} />
                        <EntityInfoBlock label="Membership" value={memberStatus || group.membershipStatus || '—'} />
                        <EntityInfoBlock label="Languages" value={group.languages.join(', ') || '—'} />
                        <EntityInfoBlock label="Privacy" value={group.privacy || '—'} />
                        {group.links.length ? (
                            <EntityInfoBlock label="Links" full>
                                <div className="flex flex-wrap gap-1.5">
                                    {group.links.map((link) => <Button key={link} type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => openExternalLink(link)}><ExternalLinkIcon className="size-3.5" />{link}</Button>)}
                                </div>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock label="URL" value={groupUrl || '—'} mono wide onClick={groupUrl ? () => void copyGroupText(groupUrl, 'Group URL') : undefined} />
                        <EntityInfoBlock label="Group ID" value={group.id} mono wide />
                        <EntityInfoBlock
                            label="Owner"
                            value={ownerLabel || '—'}
                            wide
                            onClick={group.ownerId ? () => openUserDialog({
                                userId: group.ownerId,
                                title: ownerLabel || undefined,
                                seedData: ownerLabel
                                    ? { id: group.ownerId, displayName: ownerLabel }
                                    : null
                            }) : undefined}
                        />
                        {group.tags.length ? (
                            <EntityInfoBlock label="Tags" full>
                                <div className="flex flex-wrap gap-1.5">{group.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div>
                            </EntityInfoBlock>
                        ) : null}
                        {group.roles.length ? (
                            <EntityInfoBlock label="Roles" full>
                                <div className="flex flex-wrap gap-1.5">{group.roles.map((role) => <Badge key={role.id || role.name} variant="outline">{role.name || 'Role'}</Badge>)}</div>
                            </EntityInfoBlock>
                        ) : null}
                    </EntityInfoGrid>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="posts" className="space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="text-sm text-muted-foreground">{filteredPosts.length}/{posts.length} posts</div>
                        <Input
                            value={search.posts}
                            onChange={(event) => setSearch((current) => ({ ...current, posts: event.target.value }))}
                            placeholder="Search posts"
                            className="ml-auto h-8 max-w-64"
                        />
                    </div>
                    <RowList
                        rows={filteredPosts}
                        group={group}
                        kind="posts"
                        loading={remoteStatus.posts === 'running'}
                        error={remoteErrors.posts}
                        canManagePosts={canManagePosts}
                        onPreviewImage={(url, title) => openImagePreview({ url: convertFileUrlToImageUrl(url, 1024), title })}
                        onEditPost={(post) => void editGroupPost(post)}
                        onDeletePost={(post) => void deleteGroupPost(post)}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="members" className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm text-muted-foreground">{filteredMembers.length}/{group.memberCount || members.length} members</div>
                        <Button type="button" size="sm" variant="outline" disabled={remoteStatus.members === 'running'} onClick={() => void loadTab('members', { force: true })}>
                            Refresh
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={remoteStatus.members === 'running'} onClick={() => void loadAllMembers()}>
                            Load All
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={!members.length} onClick={() => downloadJsonFile(`${group.id}_members.json`, members)}>
                            <DownloadIcon className="size-3.5" />
                            JSON
                        </Button>
                        <Select value={memberSort} onValueChange={setMemberSort} disabled={remoteStatus.members === 'running'}>
                            <SelectTrigger size="sm" className="w-44">
                                <SelectValue placeholder="Sort" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="joinedAt:desc">Joined newest</SelectItem>
                                <SelectItem value="joinedAt:asc">Joined oldest</SelectItem>
                                <SelectItem value="user.displayName:asc">Name A-Z</SelectItem>
                                <SelectItem value="user.displayName:desc">Name Z-A</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={memberRoleId || 'all'}
                            onValueChange={(value) => setMemberRoleId(value === 'all' ? '' : value)}
                            disabled={remoteStatus.members === 'running'}>
                            <SelectTrigger size="sm" className="w-48">
                                <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All roles</SelectItem>
                                {group.roles.map((role) => (
                                    <SelectItem key={role.id || role.name} value={role.id || role.name}>
                                        {role.name || 'Role'}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            value={search.members}
                            onChange={(event) => setSearch((current) => ({ ...current, members: event.target.value }))}
                            placeholder="Search members"
                            className="ml-auto h-8 max-w-64"
                        />
                    </div>
                    <RowList rows={filteredMembers} group={group} kind="members" loading={remoteStatus.members === 'running'} error={remoteErrors.members} />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="photos" className="space-y-2">
                    <RowList
                        rows={photos}
                        group={group}
                        kind="photos"
                        loading={remoteStatus.photos === 'running'}
                        error={remoteErrors.photos}
                        onPreviewImage={(url, title) => openImagePreview({ url: convertFileUrlToImageUrl(url, 1024), title })}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="json"><EntityRawJson value={{ group, posts, instances: activeInstances, members, galleries: firstArray(group.galleries), photos, activeInstances }} /></EntityDialogTabContent>
            </EntityDialogTabs>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={setPreviousInstancesOpen}
                title={`Previous Instances - ${group.name || 'Group'}`}
                instances={previousInstances}
                variant="group"
                targetRef={group}
                onRowsChange={onPreviousInstancesChange}
            />
            <GroupPostEditorDialog
                open={Boolean(postEditor)}
                onOpenChange={(open) => {
                    if (!open && !postEditorSubmitting) {
                        setPostEditor(null);
                    }
                }}
                form={postEditor}
                onFormChange={setPostEditor}
                group={group}
                endpoint={currentEndpoint}
                submitting={postEditorSubmitting}
                onSubmit={(form) => void submitGroupPost(form)}
            />
            <GroupModerationToolsDialog
                open={moderationOpen}
                onOpenChange={setModerationOpen}
                group={group}
                endpoint={currentEndpoint}
            />
        </EntityDialogScaffold>
    );
}
