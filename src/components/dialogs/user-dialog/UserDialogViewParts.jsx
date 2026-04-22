import {
    ArrowDownIcon,
    ArrowUpIcon,
    DownloadIcon,
    EyeIcon,
    HistoryIcon,
    LogOutIcon,
    SettingsIcon,
    TagIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { timeToText } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    userImage
} from '@/lib/entityMedia.js';
import { userStatusDotClassName } from '@/lib/userStatus.js';
import { cn } from '@/lib/utils.js';
import { groupProfileRepository } from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    formatStatsDate,
    groupIdForRow,
    groupDisplayName,
    groupMemberVisibility,
    summarizeEntityRow,
    userRowSubtitle,
    userTravelingTimestamp,
    worldOccupantSubtitle
} from './userDialogRows.js';
import { languageOptionLabel } from './userProfileFields.js';
import { appI18n } from '@/services/i18nService.js';

export function UserTitleLanguages({ languages }) {
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

export function PreviousDisplayNamesBadge({ names }) {
    if (!names.length) {
        return null;
    }

    const label = `${names.length} previous ${
        names.length === 1 ? 'name' : 'names'
    }`;
    const primaryName = names[0]?.displayName || label;

    return (
        <HoverCard openDelay={150}>
            <HoverCardTrigger asChild>
                <Badge
                    asChild
                    variant="outline"
                    className="bg-background max-w-52 cursor-default text-xs"
                >
                    <button type="button" aria-label={label}>
                        <HistoryIcon data-icon="inline-start" />
                        <span className="min-w-0 truncate">{primaryName}</span>
                        {names.length > 1 ? (
                            <span className="text-muted-foreground shrink-0">
                                +{names.length - 1}
                            </span>
                        ) : null}
                    </button>
                </Badge>
            </HoverCardTrigger>
            <HoverCardContent align="start" className="w-72 p-0">
                <div className="flex flex-col">
                    <div className="border-border flex items-center justify-between gap-3 border-b px-3 py-2">
                        <div className="text-sm font-medium">
                            {appI18n.t('dialog.user.generated.previous_display_names')}
                        </div>
                        <Badge variant="secondary">{names.length}</Badge>
                    </div>
                    <div className="flex max-h-64 flex-col overflow-auto p-1">
                        {names.map((entry, index) => (
                            <div
                                key={`${entry.displayName}:${entry.updated_at || index}`}
                                className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5"
                            >
                                <span className="min-w-0 truncate font-medium">
                                    {entry.displayName}
                                </span>
                                {entry.updated_at ? (
                                    <span className="text-muted-foreground shrink-0 text-xs">
                                        {formatStatsDate(entry.updated_at)}
                                    </span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}

export function SelfPreferenceCheckboxItem({
    label,
    checked,
    disabled = false,
    onToggle
}) {
    return (
        <DropdownMenuCheckboxItem
            checked={checked}
            disabled={disabled || !onToggle}
            onCheckedChange={() => onToggle?.()}
        >
            <span className="min-w-0 flex-1">{label}</span>
            <span className="text-muted-foreground mr-4 shrink-0 text-xs">
                {checked ? 'Allow' : 'Deny'}
            </span>
        </DropdownMenuCheckboxItem>
    );
}

export function downloadJsonFile(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
        type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function rowImage(row, kind) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    if (kind === 'user') {
        return userImage(row, true, '64');
    }
    return convertFileUrlToImageUrl(
        row.thumbnailImageUrl ||
            row.imageUrl ||
            row.iconUrl ||
            row.userIcon ||
            row.currentAvatarImageUrl,
        128
    );
}

function UserGroupCard({
    group,
    editable = false,
    selectable = false,
    selected = false,
    busy = false,
    onVisibilityChange,
    onLeave,
    onMove,
    onSelectionChange
}) {
    const groupId = groupIdForRow(group);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        let active = true;
        setProfile(null);

        if (!groupId) {
            return () => {
                active = false;
            };
        }

        groupProfileRepository
            .getGroupProfile({
                groupId,
                endpoint: currentEndpoint,
                includeRoles: false
            })
            .then((groupProfile) => {
                if (active) {
                    setProfile(groupProfile);
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [currentEndpoint, groupId]);

    const displayGroup = profile ? { ...group, ...profile } : group;
    const image = rowImage(displayGroup, 'group');
    const label = groupDisplayName(displayGroup);
    const visibility = groupMemberVisibility(group);
    const visibilityValue = ['visible', 'friends', 'hidden'].includes(
        visibility
    )
        ? visibility
        : 'visible';
    const memberCount =
        Number(
            group?.memberCount ??
                group?.member_count ??
                group?.membershipCount ??
                group?.membership_count ??
                0
        ) || 0;
    return (
        <div
            className={cn(
                'flex items-center gap-1 p-1 text-sm',
                editable ? 'w-56' : 'w-44'
            )}
        >
            {selectable ? (
                <Checkbox
                    checked={selected}
                    disabled={busy}
                    aria-label={`Select ${label || 'group'}`}
                    className="shrink-0"
                    onCheckedChange={(checked) =>
                        onSelectionChange?.(group, checked === true)
                    }
                />
            ) : null}
            <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                onClick={() => openRow(displayGroup, 'group')}
            >
                {image ? (
                    <img
                        src={image}
                        alt=""
                        className="size-9 shrink-0 rounded-md object-cover"
                    />
                ) : (
                    <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md [&>svg]:size-4">
                        <UsersIcon className="text-muted-foreground" />
                    </span>
                )}
                <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate leading-snug font-medium">
                        {label || '—'}
                    </span>
                    <span className="text-muted-foreground inline-flex max-w-full items-center truncate text-xs [&>svg]:size-3.5">
                        {group?.isRepresenting || group?.is_representing ? (
                            <TagIcon
                                className="mr-1.5 shrink-0"
                                aria-label={"Representing"}
                            />
                        ) : null}
                        {visibility !== 'visible' ? (
                            <EyeIcon
                                className="mr-1.5 shrink-0"
                                aria-label={`Visibility ${visibility}`}
                            />
                        ) : null}
                        <span className="truncate">({memberCount})</span>
                    </span>
                </span>
            </Button>
            {editable ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="ml-1 shrink-0"
                            disabled={busy}
                            title={appI18n.t('dialog.user.generated.manage_group_membership')}
                            aria-label={"Manage group membership"}
                        >
                            <SettingsIcon data-icon="inline-start" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {onMove ? (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'top')
                                        }
                                    >
                                        <DownloadIcon className="rotate-180" />
                                        {appI18n.t('dialog.user.generated.move_top')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'up')
                                        }
                                    >
                                        <ArrowUpIcon />
                                        {appI18n.t('dialog.user.generated.move_up')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'down')
                                        }
                                    >
                                        <ArrowDownIcon />
                                        {appI18n.t('dialog.user.generated.move_down')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            void onMove(group, 'bottom')
                                        }
                                    >
                                        <DownloadIcon />
                                        {appI18n.t('dialog.user.generated.move_bottom')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}
                        <DropdownMenuGroup>
                            <DropdownMenuRadioGroup
                                value={visibilityValue}
                                onValueChange={(value) =>
                                    onVisibilityChange?.(group, value)
                                }
                            >
                                <DropdownMenuRadioItem value="visible">
                                    {appI18n.t('dialog.user.generated.visibility_everyone')}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="friends">
                                    {appI18n.t('dialog.user.generated.visibility_friends')}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="hidden">
                                    {appI18n.t('dialog.user.generated.visibility_hidden')}
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => onLeave?.(group)}
                            >
                                <LogOutIcon />
                                {appI18n.t('dialog.user.generated.leave_group')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
}

function openRow(row, kind) {
    const id =
        typeof row === 'string'
            ? row
            : row?.id ||
              row?.userId ||
              row?.worldId ||
              row?.avatarId ||
              row?.groupId;
    if (!id) {
        return;
    }
    if (kind === 'user' || String(id).startsWith('usr_')) {
        openUserDialog({
            userId: id,
            title: row?.displayName || row?.username || undefined,
            seedData: typeof row === 'object' ? row : null
        });
        return;
    }
    if (
        kind === 'world' ||
        String(id).startsWith('wrld_') ||
        String(id).startsWith('wld_')
    ) {
        openWorldDialog({
            worldId: id,
            title: row?.name || undefined,
            seedData: typeof row === 'object' ? row : null
        });
        return;
    }
    if (kind === 'avatar' || String(id).startsWith('avtr_')) {
        openAvatarDialog({
            avatarId: id,
            title: row?.name || undefined,
            seedData: typeof row === 'object' ? row : null
        });
        return;
    }
    if (kind === 'group' || String(id).startsWith('grp_')) {
        openGroupDialog({
            groupId: id,
            title: row?.name || undefined,
            seedData: typeof row === 'object' ? row : null
        });
    }
}

export function EntityListEmptyTitle(kind) {
    if (kind === 'user') {
        return 'No users';
    }
    if (kind === 'world') {
        return 'No worlds';
    }
    if (kind === 'avatar') {
        return 'No avatars';
    }
    if (kind === 'group') {
        return 'No groups';
    }
    return 'No results';
}

export function EntityListState({ kind, loading = false, error = '' }) {
    if (loading) {
        return (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm">
                <Spinner className="size-4" />
                <span>{appI18n.t('dialog.user.generated.loading')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                <EmptyTitle>{entityListEmptyTitle(kind)}</EmptyTitle>
                <EmptyDescription>{appI18n.t('common.no_matching_entries')}</EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

export function EntityList({
    rows,
    kind = '',
    loading = false,
    error = '',
    editableGroups = false,
    selectableGroups = false,
    selectedGroupIds = null,
    groupActionId = '',
    onGroupVisibilityChange,
    onGroupLeave,
    onGroupMove,
    onGroupSelectionChange
}) {
    if (loading) {
        return <EntityListState kind={kind} loading />;
    }
    if (error) {
        return <EntityListState kind={kind} error={error} />;
    }
    if (!rows.length) {
        return <EntityListState kind={kind} />;
    }
    const nowMs = Date.now();
    return (
        <div className="flex flex-wrap items-start">
            {rows.map((row, index) => {
                if (kind === 'group') {
                    const groupId = groupIdForRow(row);
                    return (
                        <UserGroupCard
                            key={`${row?.id || row?.groupId || row?.name || 'group'}:${index}`}
                            group={row}
                            editable={editableGroups}
                            selectable={selectableGroups}
                            selected={Boolean(selectedGroupIds?.has(groupId))}
                            busy={Boolean(
                                groupActionId &&
                                (groupActionId === groupId ||
                                    groupActionId === '__bulk_groups__')
                            )}
                            onVisibilityChange={onGroupVisibilityChange}
                            onLeave={onGroupLeave}
                            onMove={onGroupMove}
                            onSelectionChange={onGroupSelectionChange}
                        />
                    );
                }
                const image = rowImage(row, kind);
                const label =
                    kind === 'user'
                        ? row?.displayName || row?.username || ''
                        : summarizeEntityRow(row);
                const subtitle =
                    kind === 'user'
                        ? userRowSubtitle(row, nowMs)
                        : kind === 'world'
                          ? worldOccupantSubtitle(row)
                          : row?.authorName ||
                            row?.description ||
                            row?.shortCode ||
                            row?.username ||
                            '';
                const imageRoundedClassName =
                    kind === 'user' ? 'rounded-full' : 'rounded-md';
                const travelingTimestamp =
                    kind === 'user' ? userTravelingTimestamp(row) : 0;
                const dotClassName =
                    kind === 'user' ? userStatusDotClassName(row) : '';
                return (
                    <Button
                        key={`${row?.id || row?.userId || label}:${index}`}
                        type="button"
                        variant="ghost"
                        className="h-auto w-44 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                        onClick={() => openRow(row, kind)}
                    >
                        <span className="relative size-9 shrink-0">
                            {image ? (
                                <img
                                    src={image}
                                    alt=""
                                    className={cn(
                                        'size-9 object-cover',
                                        imageRoundedClassName
                                    )}
                                />
                            ) : (
                                <span
                                    className={cn(
                                        'bg-muted flex size-9 items-center justify-center [&>svg]:size-4',
                                        imageRoundedClassName
                                    )}
                                >
                                    <UserIcon className="text-muted-foreground" />
                                </span>
                            )}
                            {dotClassName ? (
                                <span
                                    className={cn(
                                        'border-background absolute right-0 bottom-0 z-10 size-2.5 rounded-full border',
                                        dotClassName
                                    )}
                                />
                            ) : null}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span
                                className="block truncate leading-snug font-medium"
                                style={
                                    kind === 'user' && row?.$userColour
                                        ? { color: row.$userColour }
                                        : undefined
                                }
                            >
                                {label || '—'}
                            </span>
                            {travelingTimestamp ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    <Spinner
                                        data-icon="inline-start"
                                        className="mr-1 inline-block"
                                    />
                                    {timeToText(
                                        Date.now() - travelingTimestamp
                                    )}
                                </span>
                            ) : subtitle ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    {subtitle}
                                </span>
                            ) : null}
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}

export function UserGroupSection({
    title,
    rows,
    countText,
    editableGroups = false,
    selectableGroups = false,
    selectedGroupIds = null,
    groupActionId = '',
    onGroupVisibilityChange,
    onGroupLeave,
    onGroupMove,
    onGroupSelectionChange
}) {
    if (!rows.length) {
        return null;
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-baseline gap-1.5">
                <span className="text-base font-bold">{title}</span>
                <span className="text-muted-foreground text-xs">
                    {countText || rows.length}
                </span>
            </div>
            <EntityList
                rows={rows}
                kind="group"
                editableGroups={editableGroups}
                selectableGroups={selectableGroups}
                selectedGroupIds={selectedGroupIds}
                groupActionId={groupActionId}
                onGroupVisibilityChange={onGroupVisibilityChange}
                onGroupLeave={onGroupLeave}
                onGroupMove={onGroupMove}
                onGroupSelectionChange={onGroupSelectionChange}
            />
        </section>
    );
}

export function FavoriteWorldGroups({
    groups,
    rows,
    search,
    filteredRows,
    loading,
    error
}) {
    const groupedRows = groups.length
        ? groups.map((group) => ({
              key: group.name,
              label: group.displayName || group.name,
              visibility: group.visibility || '',
              rows: rows.filter(
                  (world) =>
                      world.$favoriteGroupKey === group.name ||
                      world.$favoriteGroup === (group.displayName || group.name)
              )
          }))
        : Array.from(
              rows
                  .reduce((map, world) => {
                      const key = world.$favoriteGroup || 'Favorites';
                      if (!map.has(key)) {
                          map.set(key, {
                              key,
                              label: key,
                              visibility: '',
                              rows: []
                          });
                      }
                      map.get(key).rows.push(world);
                      return map;
                  }, new Map())
                  .values()
          );
    const [activeGroup, setActiveGroup] = useState(groupedRows[0]?.key || '');

    useEffect(() => {
        if (
            groupedRows.length &&
            !groupedRows.some((group) => group.key === activeGroup)
        ) {
            setActiveGroup(groupedRows[0].key);
        }
    }, [activeGroup, groupedRows]);

    if (search.trim()) {
        return (
            <EntityList
                rows={filteredRows}
                kind="world"
                loading={loading}
                error={error}
            />
        );
    }
    if (loading || error || !groupedRows.length) {
        return (
            <EntityList
                rows={rows}
                kind="world"
                loading={loading}
                error={error}
            />
        );
    }

    return (
        <Tabs
            value={activeGroup}
            onValueChange={setActiveGroup}
            className="gap-2"
        >
            <TabsList
                variant="line"
                className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1"
            >
                {groupedRows.map((group) => (
                    <TabsTrigger
                        key={group.key}
                        value={group.key}
                        className="flex-none rounded-none px-3"
                    >
                        <span>{group.label}</span>
                        <span className="text-muted-foreground ml-1.5 text-xs">
                            {group.rows.length}
                        </span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {groupedRows.map((group) => (
                <TabsContent key={group.key} value={group.key} className="m-0">
                    {group.visibility ? (
                        <div className="text-muted-foreground px-1 py-1 text-xs">
                            {group.visibility}
                        </div>
                    ) : null}
                    <EntityList rows={group.rows} kind="world" />
                </TabsContent>
            ))}
        </Tabs>
    );
}
