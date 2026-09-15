import type { TFunction } from 'i18next';
import {
    DownloadIcon,
    EyeOffIcon,
    MoreHorizontalIcon,
    TagIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ListSectionHeader } from '@/components/layout/ListSectionHeader';
import {
    ToolbarRefreshButton,
    ToolbarSearch
} from '@/components/layout/ToolbarControls';
import { FadeInImage } from '@/components/media/FadeInImage';
import type {
    GroupMemberRow,
    GroupProfileRecord
} from '@/domain/entities/group';
import { openUserDialog } from '@/services/dialogService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getGroupRowImage, getGroupRowLabel } from './groupDialogUtils';
import { GroupListState } from './GroupListState';
import type { GroupDialogMembersModel } from './useGroupDialogMembers';

type GroupRoleRecord = {
    id?: string;
    name?: string;
    order?: number;
    isManagementRole?: boolean;
    permissions?: string[];
};

type MemberViewMode = 'all' | 'friends';

type MemberBucket = {
    key: string;
    title: string;
    roleId: string | null;
    rows: GroupMemberRow[];
};

const ROLE_CHIP_LIMIT = 2;
const BASE_BUCKET_KEY = 'members';
const AUTO_COLLAPSE_COUNT = 100;
const ROLE_NAME_KEYS: Record<string, string> = {
    'Group Owner': 'dialog.group.role_name.group_owner',
    Everyone: 'dialog.group.role_name.everyone',
    Member: 'dialog.group.role_name.member'
};

function roleLabel(name: string | undefined, t: TFunction) {
    const key = name ? ROLE_NAME_KEYS[name] : undefined;
    return key ? t(key) : name || '';
}

function isNotableRole(role: GroupRoleRecord) {
    return Boolean(
        role.id &&
        (role.isManagementRole ||
            (Array.isArray(role.permissions) && role.permissions.length > 0))
    );
}

function rankedRoles(group: GroupProfileRecord | null) {
    return groupRoles(group)
        .filter(isNotableRole)
        .sort(
            (left, right) =>
                (left.order ?? Number.MAX_SAFE_INTEGER) -
                (right.order ?? Number.MAX_SAFE_INTEGER)
        );
}

function bucketRows(
    rows: GroupMemberRow[],
    roles: GroupRoleRecord[],
    t: TFunction
): MemberBucket[] {
    const byRole = new Map<string, GroupMemberRow[]>();
    const base: GroupMemberRow[] = [];
    for (const row of rows) {
        const roleIds = Array.isArray(row.roleIds) ? row.roleIds : [];
        const top = roles.find((role) => role.id && roleIds.includes(role.id));
        if (top?.id) {
            const list = byRole.get(top.id) ?? [];
            list.push(row);
            byRole.set(top.id, list);
        } else {
            base.push(row);
        }
    }
    const buckets: MemberBucket[] = [];
    for (const role of roles) {
        const list = role.id ? byRole.get(role.id) : undefined;
        if (role.id && list?.length) {
            buckets.push({
                key: role.id,
                title: roleLabel(role.name, t),
                roleId: role.id,
                rows: list
            });
        }
    }
    buckets.push({
        key: BASE_BUCKET_KEY,
        title: roleLabel('Everyone', t),
        roleId: null,
        rows: base
    });
    return buckets;
}

function groupRoles(group: GroupProfileRecord | null): GroupRoleRecord[] {
    return Array.isArray(group?.roles)
        ? (group.roles as GroupRoleRecord[])
        : [];
}

export function staffRoleIdsOf(group: GroupProfileRecord | null): string[] {
    return rankedRoles(group).map((role) => role.id as string);
}

function memberKey(row: GroupMemberRow) {
    return row.userId || row.id;
}

function dedupeRows(rows: GroupMemberRow[]) {
    const seen = new Set<string>();
    return rows.filter((row) => {
        const key = memberKey(row);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function GroupMemberTile({
    row,
    group,
    omitRoleId,
    isFriend
}: {
    row: GroupMemberRow;
    group: GroupProfileRecord | null;
    omitRoleId: string | null;
    isFriend: boolean;
}) {
    const { t } = useTranslation();
    const label = getGroupRowLabel(row);
    const image = getGroupRowImage(row, 'members');
    const user = row.user ?? null;
    const memberUserId = row.userId || user?.id || '';
    const notableRoles = rankedRoles(group).filter(
        (role) =>
            role.id !== omitRoleId &&
            Array.isArray(row.roleIds) &&
            row.roleIds.includes(role.id as string)
    );
    const visibleRoles = notableRoles.slice(0, ROLE_CHIP_LIMIT);
    const hiddenRoles = notableRoles.slice(ROLE_CHIP_LIMIT);
    const hiddenMembership =
        isFriend && row.visibility && row.visibility !== 'visible';

    return (
        <Button
            type="button"
            variant="ghost"
            className="box-border h-auto w-full min-w-0 justify-start gap-2.5 p-1.5 text-left text-sm font-normal"
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
                    className="size-9 shrink-0 rounded-full object-cover"
                />
            ) : (
                <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
                    <UserIcon className="text-muted-foreground" />
                </div>
            )}
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="flex min-w-0 items-center gap-1 leading-5 font-medium">
                    <span className="truncate">{label}</span>
                    {row.isRepresenting ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <TagIcon className="text-muted-foreground size-3.5 shrink-0" />
                                }
                            />
                            <TooltipContent>
                                {t('dialog.group.members.representing')}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    {hiddenMembership ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    row.visibility === 'friends' ? (
                                        <UsersIcon className="text-muted-foreground size-3.5 shrink-0" />
                                    ) : (
                                        <EyeOffIcon className="text-muted-foreground size-3.5 shrink-0" />
                                    )
                                }
                            />
                            <TooltipContent>
                                {row.visibility === 'friends'
                                    ? t('dialog.user.label.visibility_friends')
                                    : t('dialog.user.label.visibility_hidden')}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                </span>
                {visibleRoles.length ? (
                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                        {visibleRoles.map((role) => (
                            <Badge
                                key={role.id}
                                variant="outline"
                                className="text-muted-foreground h-4 max-w-full px-1.5 text-[10px] font-normal"
                            >
                                <span className="truncate">
                                    {roleLabel(role.name, t)}
                                </span>
                            </Badge>
                        ))}
                        {hiddenRoles.length ? (
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Badge
                                            variant="outline"
                                            className="text-muted-foreground h-4 px-1.5 text-[10px] font-normal tabular-nums"
                                        >
                                            +{hiddenRoles.length}
                                        </Badge>
                                    }
                                />
                                <TooltipContent>
                                    {hiddenRoles
                                        .map((role) => roleLabel(role.name, t))
                                        .join(', ')}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                    </span>
                ) : null}
            </span>
        </Button>
    );
}

function MemberTileGrid({
    rows,
    group,
    isFriend,
    omitRoleId = null
}: {
    rows: GroupMemberRow[];
    group: GroupProfileRecord | null;
    isFriend: (row: GroupMemberRow) => boolean;
    omitRoleId?: string | null;
}) {
    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-1">
            {rows.map((row) => (
                <GroupMemberTile
                    key={memberKey(row)}
                    row={row}
                    group={group}
                    omitRoleId={omitRoleId}
                    isFriend={isFriend(row)}
                />
            ))}
        </div>
    );
}

export function GroupMembersPanel({
    active,
    group,
    members,
    onExport,
    onLoadMore,
    onQueryChange,
    onRefresh
}: {
    active: boolean;
    group: GroupProfileRecord;
    members: GroupDialogMembersModel;
    onExport: (scope: 'loaded' | 'all') => void;
    onLoadMore: () => void;
    onQueryChange: (value: string) => void;
    onRefresh: () => void;
}) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const [viewMode, setViewMode] = useState<MemberViewMode>('all');
    const [toggled, setToggled] = useState<Set<string>>(() => new Set());
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const loadMoreCallbackRef = useRef(onLoadMore);
    loadMoreCallbackRef.current = onLoadMore;

    const membersBusy = members.status === 'running';
    const memberTotal = members.totalCount ?? members.loadedCount;
    const isFriend = (row: GroupMemberRow) =>
        Boolean(friendsById[row.userId || row.user?.id || '']);
    const pool = dedupeRows([...members.staffRows, ...members.rows]);
    const visiblePool = viewMode === 'friends' ? pool.filter(isFriend) : pool;
    const allBuckets = bucketRows(visiblePool, rankedRoles(group), t);
    const rankedCount = allBuckets
        .filter((bucket) => bucket.roleId)
        .reduce((total, bucket) => total + bucket.rows.length, 0);
    const baseLoaded = allBuckets.at(-1)?.rows.length ?? 0;
    const baseCount =
        viewMode === 'all'
            ? Math.max(memberTotal - rankedCount, baseLoaded)
            : baseLoaded;
    const buckets = allBuckets.filter((bucket) =>
        bucket.roleId ? bucket.rows.length > 0 : baseCount > 0
    );
    const isBucketOpen = (key: string, count: number) =>
        toggled.has(`${viewMode}:${key}`) === count > AUTO_COLLAPSE_COUNT;
    const autoLoad =
        members.hasMore &&
        (viewMode === 'friends' || isBucketOpen(BASE_BUCKET_KEY, baseCount));

    function toggleBucket(key: string) {
        setToggled((current) => {
            const next = new Set(current);
            const scoped = `${viewMode}:${key}`;
            if (next.has(scoped)) {
                next.delete(scoped);
            } else {
                next.add(scoped);
            }
            return next;
        });
    }

    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !active || !autoLoad) {
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                loadMoreCallbackRef.current();
            }
        });
        observer.observe(node);
        return () => {
            observer.disconnect();
        };
    }, [active, autoLoad, members.loadedCount]);

    const listBusy = members.isSearching
        ? members.searchStatus === 'running' && !members.rows.length
        : membersBusy && !pool.length;
    const listEmpty =
        !members.isSearching && !members.hasMore && !buckets.length;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <ToolbarSearch
                    className="w-auto min-w-56 flex-1 shrink sm:w-auto"
                    value={members.query}
                    onValueChange={onQueryChange}
                    placeholder={t('dialog.group.members.search')}
                />
                <ToggleGroup
                    variant="outline"
                    size="sm"
                    value={[viewMode]}
                    disabled={members.isSearching}
                    onValueChange={(next) => {
                        const value = next[0];
                        if (value === 'all' || value === 'friends') {
                            setViewMode(value);
                        }
                    }}
                >
                    {(
                        [
                            ['all', t('dialog.group.members.view_all')],
                            ['friends', t('dialog.group.members.friends')]
                        ] as const
                    ).map(([value, label], index) => (
                        <Fragment key={value}>
                            {index > 0 ? <ToggleGroupSeparator /> : null}
                            <ToggleGroupItem value={value} className="text-xs">
                                {label}
                            </ToggleGroupItem>
                        </Fragment>
                    ))}
                </ToggleGroup>
                <div className="ml-auto flex items-center gap-1">
                    <ToolbarRefreshButton
                        onRefresh={onRefresh}
                        loading={membersBusy}
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t('accessibility.more')}
                                />
                            }
                        >
                            <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                disabled={!members.loadedCount}
                                onClick={() => onExport('loaded')}
                            >
                                <DownloadIcon />
                                {t('dialog.group.members.export_loaded', {
                                    count: members.loadedCount
                                })}
                            </DropdownMenuItem>
                            {members.hasMore ? (
                                <DropdownMenuItem
                                    onClick={() => onExport('all')}
                                >
                                    <DownloadIcon />
                                    {t('dialog.group.members.export_all', {
                                        count: memberTotal
                                    })}
                                </DropdownMenuItem>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {listBusy || members.error ? (
                <GroupListState
                    title={t('dialog.group.members.header')}
                    loading={listBusy}
                    error={members.error}
                />
            ) : members.isSearching ? (
                members.rows.length ? (
                    <>
                        <MemberTileGrid
                            rows={members.rows}
                            group={group}
                            isFriend={isFriend}
                        />
                        <div className="text-muted-foreground px-1 text-xs">
                            {t('dialog.group.members.search_results', {
                                count: members.rows.length
                            })}
                        </div>
                    </>
                ) : members.searchStatus === 'ready' ? (
                    <GroupListState title={t('dialog.group.members.header')} />
                ) : null
            ) : listEmpty ? (
                <GroupListState title={t('dialog.group.members.header')} />
            ) : (
                <div className="flex flex-col gap-1">
                    {buckets.map((bucket, index) => {
                        const count = bucket.roleId
                            ? bucket.rows.length
                            : baseCount;
                        const open = isBucketOpen(bucket.key, count);
                        return (
                            <section
                                key={bucket.key}
                                className="flex flex-col gap-1"
                            >
                                <ListSectionHeader
                                    id={bucket.key}
                                    title={bucket.title}
                                    count={count}
                                    open={open}
                                    isFirst={index === 0}
                                    onToggle={toggleBucket}
                                />
                                {open ? (
                                    <MemberTileGrid
                                        rows={bucket.rows}
                                        group={group}
                                        omitRoleId={bucket.roleId}
                                        isFriend={isFriend}
                                    />
                                ) : null}
                            </section>
                        );
                    })}
                    {members.hasMore || members.loadedCount ? (
                        <div
                            ref={loadMoreRef}
                            className="text-muted-foreground flex items-center justify-center gap-3 px-1 py-1 text-xs"
                        >
                            <span className="tabular-nums">
                                {t('dialog.group.members.loaded_of_total', {
                                    loaded: members.loadedCount,
                                    total: memberTotal
                                })}
                            </span>
                            {members.hasMore ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={members.isLoadingMore}
                                    onClick={onLoadMore}
                                >
                                    {t('common.load_more')}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
