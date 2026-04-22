import {
    ArrowDownIcon,
    ArrowUpIcon,
    BanIcon,
    CheckIcon,
    ClockIcon,
    CopyIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    HistoryIcon,
    LanguagesIcon,
    LogOutIcon,
    MailIcon,
    MapPinIcon,
    MessageSquareIcon,
    MousePointerIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    Share2Icon,
    ShieldCheckIcon,
    TagIcon,
    UserIcon,
    UserMinusIcon,
    UsersIcon,
    VolumeXIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { Location } from '@/components/Location.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import { timeToText } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink,
    userImage
} from '@/lib/entityMedia.js';
import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import {
    userStatusDotClassName,
    userStatusIndicatorClassName
} from '@/lib/userStatus.js';
import { cn } from '@/lib/utils.js';
import { backend } from '@/platform/tauri/backend.js';
import {
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
    avatarProfileRepository,
    avatarSearchProviderRepository,
    groupProfileRepository,
    userProfileRepository,
    vrchatAuthRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { isActionRecent } from '@/services/recentActionService.js';
import {
    getTranslationConfig,
    translateText
} from '@/services/translationService.js';
import {
    userDialogGroupSortingOptions,
    userDialogMutualFriendSortingOptions
} from '@/shared/constants/user.js';
import { parseLocation } from '@/shared/utils/location.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

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
import { PreviousInstancesPanel } from './PreviousInstancesTableDialog.jsx';
import {
    firstNonGroupIdText,
    formatDate,
    formatStatsDate,
    formatStatsDuration,
    groupIdForRow,
    groupDisplayName,
    groupMemberVisibility,
    isGroupId,
    isOfflineLikeValue,
    normalizedText,
    resolveTabValue,
    summarizeEntityRow,
    userIdForRow,
    userRowSubtitle,
    userTravelingTimestamp,
    worldOccupantSubtitle
} from './user-dialog/userDialogRows.js';
import {
    isUserDialogDataTab,
    loadUserDialogTabData,
    userDialogDataKeyForTab
} from './user-dialog/userDialogTabService.js';
import {
    buildUserDialogListViewData,
    buildUserDialogProfileSummary
} from './user-dialog/userDialogViewData.js';
import { languageOptionLabel } from './user-dialog/userProfileFields.js';
import { UserActivityPanel } from './UserActivityPanel.jsx';
import { appI18n } from '@/services/i18nService.js';

const userDialogTabServiceRepositories = Object.freeze({
    avatarProfileRepository,
    avatarSearchProviderRepository,
    groupProfileRepository,
    userProfileRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
});

function UserTitleLanguages({ languages }) {
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

function PreviousDisplayNamesBadge({ names }) {
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

function SelfPreferenceCheckboxItem({
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

function downloadJsonFile(filename, value) {
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

function entityListEmptyTitle(kind) {
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

function EntityListState({ kind, loading = false, error = '' }) {
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

function EntityList({
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

function UserGroupSection({
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

function FavoriteWorldGroups({
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

let lastUserDialogTab = 'info';

const emptyUserDialogRemoteData = Object.freeze({
    groups: Object.freeze([]),
    mutual: Object.freeze([]),
    worlds: Object.freeze([]),
    favoriteWorldGroups: Object.freeze([]),
    favoriteWorlds: Object.freeze([]),
    avatars: Object.freeze([])
});

const emptyUserDialogStatus = Object.freeze({});

const emptyUserDialogSearch = Object.freeze({
    mutual: '',
    groups: '',
    worlds: '',
    favoriteWorlds: '',
    avatars: ''
});

export function UserDialogTabbedView({
    profile,
    memo,
    detail,
    imageUrl,
    loadStatus,
    actionStatus,
    recentActionVersion = 0,
    reloadToken = 0,
    moderationState,
    extendedModerationState = { interactOff: false, muteChat: false },
    avatarOverrideState = { hideAvatar: false, showAvatar: false },
    isCurrentUser,
    isFriend,
    isFavorite,
    friendRequestState,
    platform,
    platformIcon: PlatformIcon,
    presenceLocation,
    currentAvatarTarget,
    homeLocationTarget,
    canInviteFromCurrentLocation,
    currentUserHasSharedConnectionsOptOut,
    currentUserBoopingEnabled,
    userStats = {},
    previousInstances = [],
    representedGroup = null,
    representedGroupStatus = 'idle',
    hideUserNotes = false,
    hideUserMemos = false,
    onPreviousInstancesChange,
    sameInstanceUsers = [],
    locationOwnerUser = null,
    locationOwnerGroup = null,
    locationInstance = null,
    locationFriendCount = 0,
    locationPlayerCount = 0,
    onRefreshLocation,
    onRefresh,
    onEditMemo,
    onFriendRequest,
    onInvite,
    onInviteMessage,
    onInviteRequest,
    onInviteRequestMessage,
    onBoop,
    onUnfriend,
    onModeration,
    onExtendedModeration,
    onAvatarOverride,
    onReportHacking,
    onGroupModeration,
    onEditSelfStatus,
    onEditSelfLanguages,
    onEditSelfBio,
    onEditSelfBioLinks,
    onEditSelfPronouns,
    onToggleSelfAvatarCopying,
    onToggleSelfBooping,
    onToggleSelfSharedConnections,
    onToggleSelfDiscordConnections,
    onToggleBadgeVisibility,
    onToggleBadgeShowcased
}) {
    const { t } = useI18n();
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const inGameGroupOrder = useRuntimeStore(
        (state) => state.groupInstances.groupOrder
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('info');
    const [remoteData, setRemoteData] = useState(emptyUserDialogRemoteData);
    const [remoteStatus, setRemoteStatus] = useState(emptyUserDialogStatus);
    const [remoteErrors, setRemoteErrors] = useState(emptyUserDialogStatus);
    const [search, setSearch] = useState(emptyUserDialogSearch);
    const [worldSort, setWorldSort] = useState('updated');
    const [worldOrder, setWorldOrder] = useState('descending');
    const [avatarSort, setAvatarSort] = useState('name');
    const [avatarReleaseStatus, setAvatarReleaseStatus] = useState('all');
    const [mutualSort, setMutualSort] = useState('alphabetical');
    const [groupSort, setGroupSort] = useState(
        isCurrentUser ? 'inGame' : 'alphabetical'
    );
    const [vrchatConfigConstants, setVrchatConfigConstants] = useState(null);
    const [bioTranslation, setBioTranslation] = useState({
        userId: '',
        source: '',
        text: ''
    });
    const [bioTranslationLoading, setBioTranslationLoading] = useState(false);
    const [groupActionId, setGroupActionId] = useState('');
    const [groupEditMode, setGroupEditMode] = useState(false);
    const [selectedGroupIds, setSelectedGroupIds] = useState(() => new Set());
    const effectiveAvatarReleaseStatus =
        profile.id === currentUserId ? avatarReleaseStatus : 'all';
    const loadContextRef = useRef({
        endpoint: currentEndpoint,
        userId: profile.id,
        reloadToken
    });
    const handledReloadTokenRef = useRef(reloadToken);
    const {
        profileGroups,
        mutualFriends,
        profileWorlds,
        favoriteWorlds,
        profileAvatars,
        bioLinks,
        filteredMutualFriends,
        visibleMutualFriends,
        effectiveGroupSort,
        sortedProfileGroups,
        filteredProfileGroups,
        selectedUserGroups,
        filteredProfileWorlds,
        filteredFavoriteWorlds,
        visibleProfileAvatars,
        tabs,
        groupSearchActive
    } = useMemo(
        () =>
            buildUserDialogListViewData({
                profile,
                remoteData,
                remoteStatus,
                friendsById,
                search,
                mutualSort,
                groupSort,
                isCurrentUser,
                inGameGroupOrder,
                selectedGroupIds,
                effectiveAvatarReleaseStatus,
                avatarSort,
                currentUserHasSharedConnectionsOptOut
            }),
        [
            avatarSort,
            currentUserHasSharedConnectionsOptOut,
            effectiveAvatarReleaseStatus,
            friendsById,
            groupSort,
            inGameGroupOrder,
            isCurrentUser,
            mutualSort,
            profile,
            remoteData,
            remoteStatus,
            search,
            selectedGroupIds
        ]
    );
    const isRecentDialogAction = (actionType) =>
        recentActionVersion >= 0 && isActionRecent(profile.id, actionType);
    const recentDialogShortcut = (actionType) =>
        isRecentDialogAction(actionType) ? (
            <ClockIcon className="text-muted-foreground size-3.5" />
        ) : null;
    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            worldSort,
            worldOrder,
            avatarSort,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteData(emptyUserDialogRemoteData);
        setRemoteStatus(emptyUserDialogStatus);
        setRemoteErrors(emptyUserDialogStatus);
        setSearch(emptyUserDialogSearch);
        const nextTab = resolveTabValue(tabs, lastUserDialogTab);
        lastUserDialogTab = nextTab;
        setActiveTab(nextTab);
    }, [
        currentEndpoint,
        currentUserHasSharedConnectionsOptOut,
        isCurrentUser,
        profile.id,
        reloadToken
    ]);

    useLayoutEffect(() => {
        setAvatarSort('name');
        setAvatarReleaseStatus('all');
    }, [currentUserId, profile.id]);

    function isCurrentLoadContext(context) {
        return (
            loadContextRef.current.endpoint === context.endpoint &&
            loadContextRef.current.userId === context.userId &&
            loadContextRef.current.reloadToken === context.reloadToken &&
            (context.tab !== 'worlds' ||
                (context.worldSort === worldSort &&
                    context.worldOrder === worldOrder)) &&
            (context.tab !== 'avatars' ||
                (context.avatarSort === avatarSort &&
                    context.avatarReleaseStatus ===
                        effectiveAvatarReleaseStatus))
        );
    }

    async function loadTab(tab, { force = false } = {}) {
        if (
            !profile.id ||
            (!force &&
                (remoteStatus[tab] === 'running' ||
                    remoteStatus[tab] === 'ready'))
        ) {
            return;
        }
        if (!isUserDialogDataTab(tab)) {
            return;
        }

        const loadContext = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            tab,
            worldSort,
            worldOrder,
            avatarSort,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        try {
            const { rows, favoriteWorldGroups } = await loadUserDialogTabData({
                tab,
                userId: profile.id,
                endpoint: currentEndpoint,
                currentUserId,
                worldSort,
                worldOrder,
                avatarSort,
                effectiveAvatarReleaseStatus,
                repositories: userDialogTabServiceRepositories
            });

            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            const dataKey = userDialogDataKeyForTab(tab);
            setRemoteData((current) => ({
                ...current,
                [dataKey]: rows,
                ...(tab === 'favorite-worlds' ? { favoriteWorldGroups } : {})
            }));
            setRemoteStatus((current) => ({ ...current, [tab]: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, [tab]: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                [tab]:
                    error instanceof Error
                        ? error.message
                        : 'Failed to load tab data.'
            }));
        }
    }

    function changeTab(tab) {
        lastUserDialogTab = resolveTabValue(tabs, tab);
        setActiveTab(lastUserDialogTab);
    }

    function changeWorldSort(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldSort: value
        };
        setWorldSort(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeWorldOrder(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldOrder: value
        };
        setWorldOrder(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeAvatarSort(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarSort: value
        };
        setAvatarSort(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    function changeAvatarReleaseStatus(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarReleaseStatus: value
        };
        setAvatarReleaseStatus(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    useEffect(() => {
        const shouldForceReload =
            reloadToken > 0 && handledReloadTokenRef.current !== reloadToken;
        if (shouldForceReload) {
            handledReloadTokenRef.current = reloadToken;
        }
        void loadTab(activeTab, { force: shouldForceReload });
    }, [activeTab, currentEndpoint, currentUserId, profile.id, reloadToken]);

    useEffect(() => {
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (active) {
                    setVrchatConfigConstants(response?.json?.constants || null);
                }
            })
            .catch(() => {
                if (active) {
                    setVrchatConfigConstants(null);
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint]);

    useEffect(() => {
        if (activeTab === 'worlds') {
            void loadTab('worlds', { force: true });
        }
    }, [worldOrder, worldSort]);

    useEffect(() => {
        if (activeTab === 'avatars' && profile.id === currentUserId) {
            void loadTab('avatars', { force: true });
        }
    }, [avatarReleaseStatus, avatarSort]);

    useEffect(
        () =>
            onPreferenceChanged(AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS, () => {
                if (profile.id === currentUserId) {
                    return;
                }
                setRemoteData((current) => ({ ...current, avatars: [] }));
                setRemoteStatus((current) => ({ ...current, avatars: '' }));
                setRemoteErrors((current) => ({ ...current, avatars: '' }));
                if (activeTab === 'avatars') {
                    void loadTab('avatars', { force: true });
                }
            }),
        [
            activeTab,
            avatarReleaseStatus,
            avatarSort,
            currentEndpoint,
            currentUserId,
            profile.id
        ]
    );

    useEffect(() => {
        setBioTranslation({
            userId: profile.id || '',
            source: profile.bio || '',
            text: ''
        });
        setBioTranslationLoading(false);
    }, [profile.id, profile.bio]);

    useEffect(() => {
        setGroupEditMode(false);
        setSelectedGroupIds(new Set());
        setMutualSort('alphabetical');
        setGroupSort(isCurrentUser ? 'inGame' : 'alphabetical');
    }, [currentUserId, profile.id]);

    const userUrl = profile.id
        ? `https://vrchat.com/home/user/${profile.id}`
        : '';
    const username =
        profile.username && profile.username !== profile.id
            ? profile.username
            : '';
    const userSubtitle = username;
    const pronounsText = Array.isArray(profile.pronouns)
        ? profile.pronouns.join(', ')
        : profile.pronouns;
    const {
        previousDisplayNames,
        statusStateText,
        userGroupSections,
        selectedGroupCount,
        ownGroupCountText,
        remainingGroupCountText,
        userTimeSpent,
        userJoinCount,
        lastSeen,
        profileLanguages,
        mutualFriendCount,
        friendNumber
    } = buildUserDialogProfileSummary({
        profile,
        userStats,
        sortedProfileGroups,
        selectedUserGroups,
        mutualFriends,
        isCurrentUser,
        vrchatConfigConstants,
        currentUserSnapshot
    });
    const statusIndicatorClassName = userStatusIndicatorClassName(profile, {
        showOffline: true
    });
    const currentAvatarDisplayName = String(
        profile.currentAvatarName || profile.avatarName || ''
    ).trim();
    const currentAvatarDialogArgs = {
        avatarId: currentAvatarTarget,
        ...(currentAvatarDisplayName
            ? {
                  title: currentAvatarDisplayName,
                  seedData: {
                      id: currentAvatarTarget,
                      name: currentAvatarDisplayName,
                      imageUrl: profile.currentAvatarImageUrl || '',
                      thumbnailImageUrl:
                          profile.currentAvatarThumbnailImageUrl || ''
                  }
              }
            : {})
    };
    const fallbackAvatarTarget =
        typeof profile.fallbackAvatar === 'string'
            ? profile.fallbackAvatar.trim()
            : '';
    const fallbackAvatarDialogArgs = {
        avatarId: fallbackAvatarTarget,
        title: 'Fallback Avatar'
    };
    const visibleHomeLocationTarget = isOfflineLikeValue(homeLocationTarget)
        ? ''
        : homeLocationTarget;
    const visiblePresenceLocation = isOfflineLikeValue(presenceLocation)
        ? ''
        : presenceLocation;
    const visiblePresenceParsedLocation = visiblePresenceLocation
        ? parseLocation(visiblePresenceLocation)
        : null;
    const locationWorldTitle = normalizedText(
        profile.worldName ||
            profile.$worldName ||
            profile.$location?.worldName ||
            profile.$location?.name ||
            profile.$location?.world?.name
    );
    const translatedBioActive = Boolean(
        bioTranslation.userId === profile.id &&
        bioTranslation.source === (profile.bio || '') &&
        bioTranslation.text
    );
    const visibleBio = translatedBioActive
        ? bioTranslation.text
        : profile.bio || '—';
    const locationUsers = [];
    const locationUserRowsByKey = new Map();

    function addLocationUser(user, subtitle = '') {
        if (!user) {
            return;
        }
        const source =
            typeof user === 'string'
                ? { id: user, userId: user, displayName: user }
                : user;
        const userId = normalizedText(
            source.id || source.userId || source.targetUserId
        );
        const displayName = normalizedText(
            source.displayName || source.username || source.name || userId
        );
        const key =
            userId ||
            `display:${displayName.toLowerCase()}:${locationUsers.length}`;
        if (!key) {
            return;
        }

        const existing = locationUserRowsByKey.get(key);
        if (existing) {
            if (subtitle && !existing.$subtitle) {
                existing.$subtitle = subtitle;
            }
            if (source.$userColour && !existing.$userColour) {
                existing.$userColour = source.$userColour;
            }
            return;
        }

        const row = {
            ...source,
            id: userId || source.id,
            userId: source.userId || userId,
            displayName,
            $subtitle: subtitle || source.$subtitle || source.subtitle || ''
        };
        locationUserRowsByKey.set(key, row);
        locationUsers.push(row);
    }

    addLocationUser(locationOwnerUser, t('dialog.user.info.instance_creator'));
    for (const user of sameInstanceUsers) {
        addLocationUser(user);
    }
    if (
        visiblePresenceParsedLocation?.isRealInstance &&
        !sameInstanceUsers.length
    ) {
        addLocationUser(profile);
    }
    const locationOwnerFallbackId = normalizedText(
        visiblePresenceParsedLocation?.userId ||
            locationInstance?.ownerUserId ||
            locationInstance?.owner_user_id ||
            locationInstance?.ownerId ||
            locationInstance?.owner_id ||
            locationInstance?.userId ||
            locationInstance?.user_id ||
            locationInstance?.groupId ||
            locationInstance?.group_id ||
            locationInstance?.group?.id ||
            visiblePresenceParsedLocation?.groupId
    );
    const locationOwnerUserId = userIdForRow(locationOwnerUser);
    const locationOwnerGroupId = groupIdForRow(locationOwnerGroup);
    const locationOwnerIsGroup = Boolean(
        locationOwnerGroupId ||
        isGroupId(locationOwnerFallbackId) ||
        isGroupId(locationOwnerUserId)
    );
    const locationOwnerId =
        locationOwnerGroupId ||
        (locationOwnerIsGroup
            ? locationOwnerFallbackId || locationOwnerUserId
            : locationOwnerUserId) ||
        locationOwnerFallbackId;
    const locationOwnerName = locationOwnerIsGroup
        ? firstNonGroupIdText(
              locationOwnerGroup?.name,
              locationOwnerGroup?.displayName,
              locationOwnerGroup?.display_name,
              locationOwnerGroup?.shortCode,
              locationInstance?.groupName,
              locationInstance?.group_name,
              locationInstance?.group?.name,
              profile?.$location?.groupName,
              profile?.$location?.group_name,
              profile?.$location?.group?.name,
              locationOwnerUser?.displayName,
              locationOwnerUser?.username,
              locationOwnerUser?.name,
              locationOwnerId
          )
        : normalizedText(
              locationOwnerUser?.displayName ||
                  locationOwnerUser?.username ||
                  locationOwnerUser?.name ||
                  locationOwnerId
          );
    const locationOwnerRow =
        !locationOwnerIsGroup && locationOwnerUser
            ? {
                  ...locationOwnerUser,
                  $subtitle: t('dialog.user.info.instance_creator')
              }
            : !locationOwnerIsGroup && locationOwnerId
              ? {
                    id: locationOwnerId,
                    userId: locationOwnerId,
                    displayName: locationOwnerName,
                    $subtitle: t('dialog.user.info.instance_creator')
                }
              : null;
    const locationPlayerUsers =
        locationOwnerId && !locationOwnerIsGroup
            ? locationUsers.filter(
                  (user) => userIdForRow(user) !== locationOwnerId
              )
            : locationUsers;
    const locationInstanceUsers = locationOwnerRow
        ? [locationOwnerRow, ...locationPlayerUsers]
        : locationPlayerUsers;

    async function copyUserText(text, label) {
        await copyTextToClipboard(text);
        toast.success(appI18n.t('dialog.user.generated_dynamic.value_copied', { value: label }));
    }

    async function openDiscordProfile(discordId) {
        try {
            await backend.discord.OpenDiscordProfile(discordId);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_open_discord_profile')
            );
        }
    }

    async function toggleBioTranslation() {
        if (!profile.bio || bioTranslationLoading) {
            return;
        }
        if (translatedBioActive) {
            setBioTranslation({
                userId: profile.id || '',
                source: profile.bio || '',
                text: ''
            });
            return;
        }

        setBioTranslationLoading(true);
        try {
            const config = await getTranslationConfig();
            const translated = await translateText(
                profile.bio,
                config.bioLanguage,
                config
            );
            if (!translated) {
                throw new Error('No translation returned.');
            }
            setBioTranslation({
                userId: profile.id || '',
                source: profile.bio || '',
                text: translated
            });
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.translation_failed')
            );
        } finally {
            setBioTranslationLoading(false);
        }
    }

    async function showAvatarAuthor() {
        if (!currentAvatarTarget) {
            return;
        }
        try {
            const avatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: currentAvatarTarget,
                endpoint: currentEndpoint
            });
            if (avatar.authorId) {
                openUserDialog({
                    userId: avatar.authorId,
                    title: avatar.authorName || undefined
                });
                return;
            }
            toast.error(t('dialog.user.generated.avatar_author_unavailable'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_load_avatar_author')
            );
        }
    }

    async function inviteToGroup() {
        if (!profile.id) {
            return;
        }
        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.invite_to_group'),
            description: appI18n.t('dialog.user.generated_modal.enter_the_vrchat_group_id_to_invite_this_user_to'),
            inputValue: '',
            confirmText: appI18n.t('dialog.user.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.sendGroupInvite({
                groupId: result.value,
                userId: profile.id,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.user.generated.group_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_send_group_invite')
            );
        }
    }

    async function refreshGroupsAfterMembershipChange() {
        setRemoteStatus((current) => ({ ...current, groups: '' }));
        setRemoteData((current) => ({ ...current, groups: [] }));
        await loadTab('groups', { force: true });
    }

    async function changeGroupVisibility(group, visibility) {
        const groupId = groupIdForRow(group);
        if (!groupId || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId(groupId);
        try {
            await groupProfileRepository.setGroupMemberProps({
                groupId,
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: { visibility }
            });
            toast.success(t('dialog.user.generated.group_visibility_updated'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_group_visibility')
            );
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveUserGroup(group) {
        const groupId = groupIdForRow(group);
        if (!groupId || groupActionId) {
            return;
        }
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.leave_group'),
            description: appI18n.t('dialog.user.generated_dynamic.leave_value', { value: summarizeEntityRow(group, groupId) }),
            confirmText: appI18n.t('dialog.user.generated_modal.leave'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setGroupActionId(groupId);
        try {
            await groupProfileRepository.leaveGroup({
                groupId,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.user.generated.left_group'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_leave_group')
            );
        } finally {
            setGroupActionId('');
        }
    }

    function setGroupSelected(group, selected) {
        const groupId = groupIdForRow(group);
        if (!groupId) {
            return;
        }
        setSelectedGroupIds((current) => {
            const next = new Set(current);
            if (selected) {
                next.add(groupId);
            } else {
                next.delete(groupId);
            }
            return next;
        });
    }

    function selectVisibleGroups(rows) {
        setSelectedGroupIds((current) => {
            const next = new Set(current);
            for (const group of rows) {
                const groupId = groupIdForRow(group);
                if (groupId) {
                    next.add(groupId);
                }
            }
            return next;
        });
    }

    function clearSelectedGroups() {
        setSelectedGroupIds(new Set());
    }

    function exportUserGroups(rows) {
        const groups = rows.length ? rows : profileGroups;
        if (!groups.length) {
            toast.error(t('dialog.user.generated.no_groups_to_export'));
            return;
        }
        const filenameUser =
            normalizedText(
                profile.username || profile.displayName || profile.id
            ).replace(/[^a-z0-9_-]+/gi, '_') || 'user';
        downloadJsonFile(`vrcx-${filenameUser}-groups.json`, groups);
        toast.success(appI18n.t('dialog.user.generated_dynamic.exported_value_groups', { value: groups.length }));
    }

    async function changeSelectedGroupsVisibility(visibility) {
        if (!selectedUserGroups.length || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group) =>
                    groupProfileRepository.setGroupMemberProps({
                        groupId: groupIdForRow(group),
                        userId: currentUserId,
                        endpoint: currentEndpoint,
                        params: { visibility }
                    })
                )
            );
            const failed = results.filter(
                (result) => result.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(appI18n.t('dialog.user.generated_dynamic.failed_to_update_value_groups', { value: failed }));
            } else {
                toast.success(appI18n.t('dialog.user.generated_dynamic.updated_value_groups', { value: selectedUserGroups.length }));
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveSelectedGroups() {
        if (!selectedUserGroups.length || groupActionId) {
            return;
        }
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.leave_selected_groups'),
            description: appI18n.t('dialog.user.generated_dynamic.leave_value_selected_groups', { value: selectedUserGroups.length }),
            confirmText: appI18n.t('dialog.user.generated_modal.leave'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group) =>
                    groupProfileRepository.leaveGroup({
                        groupId: groupIdForRow(group),
                        endpoint: currentEndpoint
                    })
                )
            );
            const failed = results.filter(
                (entry) => entry.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(appI18n.t('dialog.user.generated_dynamic.failed_to_leave_value_groups', { value: failed }));
            } else {
                toast.success(appI18n.t('dialog.user.generated_dynamic.left_value_groups', { value: selectedUserGroups.length }));
                clearSelectedGroups();
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    function editableGroupOrder() {
        const nextOrder = [];
        const seen = new Set();
        const pushGroupId = (groupId) => {
            const normalizedGroupId = normalizedText(groupId);
            if (!normalizedGroupId || seen.has(normalizedGroupId)) {
                return;
            }
            seen.add(normalizedGroupId);
            nextOrder.push(normalizedGroupId);
        };
        for (const groupId of inGameGroupOrder || []) {
            pushGroupId(groupId);
        }
        for (const group of profileGroups) {
            pushGroupId(groupIdForRow(group));
        }
        return nextOrder;
    }

    async function moveGroupInGameOrder(group, direction) {
        const groupId = groupIdForRow(group);
        if (!isCurrentUser || !currentUserId || !groupId || groupActionId) {
            return;
        }
        const previousOrder = editableGroupOrder();
        const index = previousOrder.indexOf(groupId);
        if (index === -1) {
            return;
        }
        const nextOrder = previousOrder.slice();
        nextOrder.splice(index, 1);
        let nextIndex = index;
        if (direction === 'top') {
            nextIndex = 0;
        } else if (direction === 'bottom') {
            nextIndex = nextOrder.length;
        } else if (direction === 'up') {
            nextIndex = Math.max(0, index - 1);
        } else if (direction === 'down') {
            nextIndex = Math.min(nextOrder.length, index + 1);
        }
        nextOrder.splice(nextIndex, 0, groupId);
        if (previousOrder.join('\u0000') === nextOrder.join('\u0000')) {
            return;
        }
        setGroupActionId(groupId);
        useRuntimeStore
            .getState()
            .setGroupInstancesState({ groupOrder: nextOrder });
        setGroupSort('inGame');
        try {
            await backend.app.SetVRChatRegistryKey(
                `VRC_GROUP_ORDER_${currentUserId}`,
                JSON.stringify(nextOrder),
                3
            );
            toast.success(t('dialog.user.generated.group_order_updated'));
        } catch (error) {
            useRuntimeStore
                .getState()
                .setGroupInstancesState({ groupOrder: previousOrder });
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_group_order')
            );
        } finally {
            setGroupActionId('');
        }
    }

    function SearchHeader({
        searchKey,
        tab,
        rows,
        filteredRows,
        placeholder,
        children
    }) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <div className="text-muted-foreground text-sm">
                    {filteredRows.length}/{rows.length}
                </div>
                {tab ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={remoteStatus[tab] === 'running'}
                        onClick={() => void loadTab(tab, { force: true })}
                    >
                        {t('common.actions.refresh')}
                    </Button>
                ) : null}
                {children}
                <Input
                    value={search[searchKey]}
                    onChange={(event) =>
                        setSearch((current) => ({
                            ...current,
                            [searchKey]: event.target.value
                        }))
                    }
                    placeholder={placeholder}
                    className="ml-auto h-8 max-w-64"
                />
            </div>
        );
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={profile.displayName || profile.id || 'User'}
                imageClassName="aspect-[4/3] w-40"
                onImageClick={
                    imageUrl
                        ? () =>
                              openImagePreview({
                                  url: imageUrl,
                                  title:
                                      profile.displayName ||
                                      profile.username ||
                                      'User'
                              })
                        : null
                }
                imagePlaceholder={
                    <UsersIcon className="text-muted-foreground size-8" />
                }
                titlePrefix={
                    statusIndicatorClassName ? (
                        <i
                            className={statusIndicatorClassName}
                            title={statusStateText || undefined}
                        />
                    ) : null
                }
                title={profile.displayName || profile.username || 'User'}
                onTitleClick={
                    profile.displayName || profile.username
                        ? () =>
                              void copyUserText(
                                  profile.displayName || profile.username,
                                  'Display name'
                              )
                        : undefined
                }
                titleMeta={
                    <>
                        {pronounsText ? (
                            <span
                                className="text-muted-foreground shrink-0 font-mono text-xs font-normal"
                                title={t('dialog.user.pronouns')}
                            >
                                {pronounsText}
                            </span>
                        ) : null}
                        <UserTitleLanguages languages={profileLanguages} />
                        <PreviousDisplayNamesBadge
                            names={previousDisplayNames}
                        />
                    </>
                }
                subtitle={userSubtitle}
                onSubtitleClick={
                    username
                        ? () => void copyUserText(username, 'Username')
                        : undefined
                }
                description={profile.statusDescription}
                detail={detail}
                badges={
                    <>
                        {profile.$isModerator ? (
                            <Badge variant="secondary">
                                <ShieldCheckIcon data-icon="inline-start" />
                                {t('dialog.user.generated.moderator')}
                            </Badge>
                        ) : null}
                        {profile.$isTroll ? (
                            <Badge variant="destructive">{t('view.settings.appearance.user_colors.trust_levels.nuisance')}</Badge>
                        ) : null}
                        {profile.$isProbableTroll ? (
                            <Badge variant="outline">{t('view.favorite.avatars.almost_nuisance')}</Badge>
                        ) : null}
                        {profile.$customTag ? (
                            <Badge
                                variant="outline"
                                style={
                                    profile.$customTagColour
                                        ? {
                                              color: profile.$customTagColour,
                                              borderColor:
                                                  profile.$customTagColour
                                          }
                                        : undefined
                                }
                            >
                                {profile.$customTag}
                            </Badge>
                        ) : null}
                        {profile.ageVerified ? (
                            <Badge variant="outline">18+</Badge>
                        ) : null}
                        {friendNumber ? (
                            <Badge variant="outline">
                                {t('dialog.user.generated.friend')}{friendNumber}
                            </Badge>
                        ) : null}
                        {mutualFriendCount ? (
                            <Badge variant="outline">
                                {mutualFriendCount} {t('dialog.user.generated.mutual')}
                            </Badge>
                        ) : null}
                        {moderationState.block ? (
                            <Badge variant="destructive">{t('dialog.user.generated.blocked')}</Badge>
                        ) : null}
                        {moderationState.mute ? (
                            <Badge variant="destructive">{t('dialog.user.generated.muted')}</Badge>
                        ) : null}
                        <Badge variant="outline">
                            {profile.$trustLevel || 'Visitor'}
                        </Badge>
                        <Badge variant="outline">
                            {PlatformIcon ? (
                                <PlatformIcon data-icon="inline-start" />
                            ) : null}
                            {platform.label}
                        </Badge>
                        {profile.discordId ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                className="h-5 rounded-4xl px-2 py-0.5 text-xs"
                                onClick={() =>
                                    void openDiscordProfile(profile.discordId)
                                }
                            >
                                {t('dialog.user.generated.discord')}
                            </Button>
                        ) : null}
                    </>
                }
                mediaBadges={
                    <>
                        {Array.isArray(profile.badges)
                            ? profile.badges
                                  .filter((badge) => badge?.badgeImageUrl)
                                  .map((badge) => (
                                      <Popover
                                          key={
                                              badge.badgeId ||
                                              badge.id ||
                                              badge.badgeName
                                          }
                                      >
                                          <PopoverTrigger asChild>
                                              <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon"
                                                  title={appI18n.t('dialog.user.generated_dynamic.value_value', { value: badge.badgeName || 'Badge', value2: badge.hidden ? ' (Hidden)' : '' })}
                                                  className="size-8 rounded-sm p-0"
                                                  onClick={(event) =>
                                                      event.stopPropagation()
                                                  }
                                              >
                                                  <img
                                                      src={badge.badgeImageUrl}
                                                      alt={
                                                          badge.badgeName || ''
                                                      }
                                                      className={cn(
                                                          'size-8 rounded-sm object-cover',
                                                          badge.hidden &&
                                                              'grayscale'
                                                      )}
                                                  />
                                              </Button>
                                          </PopoverTrigger>
                                          <PopoverContent
                                              side="bottom"
                                              className="flex w-72 flex-col gap-3"
                                          >
                                              <Button
                                                  type="button"
                                                  variant="ghost"
                                                  className="h-auto w-full p-0"
                                                  onClick={() =>
                                                      badge.badgeImageUrl &&
                                                      openImagePreview({
                                                          url: badge.badgeImageUrl,
                                                          title:
                                                              badge.badgeName ||
                                                              profile.displayName ||
                                                              profile.username ||
                                                              'Badge'
                                                      })
                                                  }
                                              >
                                                  <img
                                                      src={badge.badgeImageUrl}
                                                      alt={
                                                          badge.badgeName || ''
                                                      }
                                                      className="max-h-56 w-full rounded-md object-contain"
                                                  />
                                              </Button>
                                              <div className="flex flex-col gap-1 text-sm">
                                                  <div className="font-medium">
                                                      {badge.badgeName ||
                                                          'Badge'}
                                                      {badge.hidden ? (
                                                          <span className="text-muted-foreground ml-1 text-xs">
                                                              (Hidden)
                                                          </span>
                                                      ) : null}
                                                  </div>
                                                  {badge.badgeDescription ? (
                                                      <div className="text-muted-foreground text-xs">
                                                          {
                                                              badge.badgeDescription
                                                          }
                                                      </div>
                                                  ) : null}
                                                  {badge.assignedAt ? (
                                                      <div className="text-muted-foreground font-mono text-xs">
                                                          {t('dialog.user.generated.assigned')}{' '}
                                                          {formatStatsDate(
                                                              badge.assignedAt
                                                          )}
                                                      </div>
                                                  ) : null}
                                              </div>
                                              {isCurrentUser ? (
                                                  <FieldGroup
                                                      data-slot="checkbox-group"
                                                      className="border-t pt-3 text-sm"
                                                  >
                                                      <Field orientation="horizontal">
                                                          <Checkbox
                                                              checked={Boolean(
                                                                  badge.hidden
                                                              )}
                                                              disabled={
                                                                  actionStatus !==
                                                                      'idle' ||
                                                                  !onToggleBadgeVisibility
                                                              }
                                                              aria-label={"Hidden"}
                                                              onCheckedChange={(
                                                                  checked
                                                              ) =>
                                                                  onToggleBadgeVisibility?.(
                                                                      badge,
                                                                      Boolean(
                                                                          checked
                                                                      )
                                                                  )
                                                              }
                                                          />
                                                          <FieldLabel>
                                                              {t('dialog.user.generated.hidden')}
                                                          </FieldLabel>
                                                      </Field>
                                                      <Field orientation="horizontal">
                                                          <Checkbox
                                                              checked={Boolean(
                                                                  badge.showcased
                                                              )}
                                                              disabled={
                                                                  actionStatus !==
                                                                      'idle' ||
                                                                  !onToggleBadgeShowcased
                                                              }
                                                              aria-label={"Showcased"}
                                                              onCheckedChange={(
                                                                  checked
                                                              ) =>
                                                                  onToggleBadgeShowcased?.(
                                                                      badge,
                                                                      Boolean(
                                                                          checked
                                                                      )
                                                                  )
                                                              }
                                                          />
                                                          <FieldLabel>
                                                              {t('dialog.user.badges.showcased')}
                                                          </FieldLabel>
                                                      </Field>
                                                  </FieldGroup>
                                              ) : null}
                                          </PopoverContent>
                                      </Popover>
                                  ))
                            : null}
                    </>
                }
                actions={
                    <>
                        {profile.userIcon ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="bg-muted size-[120px] shrink-0 overflow-hidden rounded-md border p-0"
                                onClick={() =>
                                    openImagePreview({
                                        url: convertFileUrlToImageUrl(
                                            profile.userIcon,
                                            512
                                        ),
                                        title:
                                            profile.displayName ||
                                            profile.username ||
                                            'User'
                                    })
                                }
                            >
                                <img
                                    src={userImage(profile, true, '256', true)}
                                    alt=""
                                    className="size-full object-cover"
                                />
                            </Button>
                        ) : null}
                        {!isCurrentUser ? (
                            <FavoriteActionMenu
                                kind="friend"
                                entityId={profile.id}
                                entity={profile}
                            />
                        ) : null}
                        <EntityActionDropdown
                            busy={
                                loadStatus === 'running' ||
                                actionStatus !== 'idle'
                            }
                            dangerous={
                                moderationState.block || moderationState.mute
                            }
                            indicator={
                                friendRequestState.incoming ||
                                friendRequestState.outgoing
                            }
                        >
                            <EntityActionItem
                                icon={RefreshCwIcon}
                                disabled={loadStatus === 'running'}
                                onSelect={onRefresh}
                            >
                                {t('common.actions.refresh')}
                            </EntityActionItem>
                            {userUrl ? (
                                <>
                                    <EntityActionItem
                                        icon={Share2Icon}
                                        onSelect={() =>
                                            void copyUserText(
                                                userUrl,
                                                'User URL'
                                            )
                                        }
                                    >
                                        {t('dialog.user.generated.share_copy_url')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ExternalLinkIcon}
                                        onSelect={() =>
                                            openExternalLink(userUrl)
                                        }
                                    >
                                        {t('dialog.user.generated.open_vrchat_page')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={CopyIcon}
                                        onSelect={() =>
                                            void copyUserText(
                                                profile.id,
                                                'User ID'
                                            )
                                        }
                                    >
                                        {t('dialog.user.generated.copy_user_id')}
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                </>
                            ) : null}
                            <EntityActionItem
                                icon={UserIcon}
                                onSelect={onEditMemo}
                            >
                                {t('dialog.user.generated.edit_note_memo')}
                            </EntityActionItem>
                            {currentAvatarTarget ? (
                                <EntityActionItem
                                    icon={UserIcon}
                                    onSelect={() => void showAvatarAuthor()}
                                >
                                    {t('dialog.user.actions.show_avatar_author')}
                                </EntityActionItem>
                            ) : null}
                            {fallbackAvatarTarget ? (
                                <EntityActionItem
                                    icon={UserIcon}
                                    onSelect={() =>
                                        openAvatarDialog(
                                            fallbackAvatarDialogArgs
                                        )
                                    }
                                >
                                    {t('dialog.user.actions.show_fallback_avatar')}
                                </EntityActionItem>
                            ) : null}
                            {isCurrentUser ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfStatus}
                                    >
                                        {t('dialog.user.generated.edit_social_status_2')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfLanguages}
                                    >
                                        {t('dialog.user.generated.edit_language_2')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfBio}
                                    >
                                        {t('dialog.user.generated.edit_bio')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfBioLinks}
                                    >
                                        {t('dialog.user.generated.edit_bio_links')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfPronouns}
                                    >
                                        {t('dialog.user.generated.edit_pronouns')}
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.avatar_cloning')}
                                        checked={Boolean(
                                            profile.allowAvatarCopying
                                        )}
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={onToggleSelfAvatarCopying}
                                    />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.booping')}
                                        checked={
                                            profile.isBoopingEnabled !== false
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={onToggleSelfBooping}
                                    />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.show_mutual_friends')}
                                        checked={
                                            !profile.hasSharedConnectionsOptOut
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={onToggleSelfSharedConnections}
                                    />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.show_discord_connections')}
                                        checked={
                                            !profile.hasDiscordFriendsOptOut
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={
                                            onToggleSelfDiscordConnections
                                        }
                                    />
                                </>
                            ) : null}
                            {!isCurrentUser ? (
                                <>
                                    <EntityActionSeparator />
                                    {!isFriend &&
                                    friendRequestState.incoming ? (
                                        <>
                                            <EntityActionItem
                                                icon={CheckIcon}
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={() =>
                                                    onFriendRequest('accept')
                                                }
                                            >
                                                {t('dialog.user.actions.accept_friend_request')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={XIcon}
                                                destructive
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={() =>
                                                    onFriendRequest('decline')
                                                }
                                            >
                                                {t('dialog.user.actions.decline_friend_request')}
                                            </EntityActionItem>
                                        </>
                                    ) : !isFriend &&
                                      friendRequestState.outgoing ? (
                                        <EntityActionItem
                                            icon={XIcon}
                                            disabled={actionStatus !== 'idle'}
                                            onSelect={() =>
                                                onFriendRequest('cancel')
                                            }
                                        >
                                            {t('dialog.user.actions.cancel_friend_request')}
                                        </EntityActionItem>
                                    ) : !isFriend ? (
                                        <EntityActionItem
                                            icon={UserIcon}
                                            shortcut={recentDialogShortcut(
                                                'Send Friend Request'
                                            )}
                                            disabled={actionStatus !== 'idle'}
                                            onSelect={() =>
                                                onFriendRequest('send')
                                            }
                                        >
                                            {t('dialog.user.actions.send_friend_request')}
                                        </EntityActionItem>
                                    ) : null}
                                    {isFriend ? (
                                        <>
                                            <EntityActionItem
                                                icon={MessageSquareIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Invite'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !canInviteFromCurrentLocation
                                                }
                                                onSelect={onInvite}
                                            >
                                                {t('dialog.user.generated.send_invite')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MessageSquareIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Invite Message'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !canInviteFromCurrentLocation
                                                }
                                                onSelect={onInviteMessage}
                                            >
                                                {t('dialog.invite_message.header')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MailIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Request Invite'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={onInviteRequest}
                                            >
                                                {t('dialog.user.generated.request_invite')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MailIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Request Invite Message'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={
                                                    onInviteRequestMessage
                                                }
                                            >
                                                {t('dialog.invite_request_message.header')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MousePointerIcon}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !currentUserBoopingEnabled
                                                }
                                                onSelect={onBoop}
                                            >
                                                {t('dialog.user.generated.boop')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={UserMinusIcon}
                                                destructive
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={onUnfriend}
                                            >
                                                {t('dialog.user.generated.unfriend')}
                                            </EntityActionItem>
                                        </>
                                    ) : null}
                                    <EntityActionItem
                                        icon={UsersIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() => void inviteToGroup()}
                                    >
                                        {t('dialog.user.generated.invite_to_group')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={SettingsIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onGroupModeration}
                                    >
                                        {t('dialog.user.actions.group_moderation')}
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={MapPinIcon}
                                        disabled={!previousInstances.length}
                                        onSelect={() =>
                                            changeTab('instance-history')
                                        }
                                    >
                                        {t('dialog.previous_instances.header')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive={moderationState.block}
                                        disabled={
                                            actionStatus !== 'idle' ||
                                            (!moderationState.block &&
                                                Boolean(profile.$isModerator))
                                        }
                                        onSelect={() =>
                                            onModeration(
                                                'block',
                                                !moderationState.block
                                            )
                                        }
                                    >
                                        {moderationState.block
                                            ? 'Unblock'
                                            : 'Block'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={VolumeXIcon}
                                        destructive={moderationState.mute}
                                        disabled={
                                            actionStatus !== 'idle' ||
                                            (!moderationState.mute &&
                                                Boolean(profile.$isModerator))
                                        }
                                        onSelect={() =>
                                            onModeration(
                                                'mute',
                                                !moderationState.mute
                                            )
                                        }
                                    >
                                        {moderationState.mute
                                            ? 'Unmute'
                                            : 'Mute'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={UserIcon}
                                        destructive={
                                            avatarOverrideState.hideAvatar
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onAvatarOverride?.('hideAvatar')
                                        }
                                    >
                                        {avatarOverrideState.hideAvatar
                                            ? 'Reset Hidden Avatar'
                                            : 'Hide Avatar'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={UserIcon}
                                        destructive={
                                            avatarOverrideState.showAvatar
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onAvatarOverride?.('showAvatar')
                                        }
                                    >
                                        {avatarOverrideState.showAvatar
                                            ? 'Reset Shown Avatar'
                                            : 'Show Avatar'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive={
                                            extendedModerationState.interactOff
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onExtendedModeration?.(
                                                'interactOff',
                                                !extendedModerationState.interactOff
                                            )
                                        }
                                    >
                                        {extendedModerationState.interactOff
                                            ? 'Enable Avatar Interaction'
                                            : 'Disable Avatar Interaction'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={VolumeXIcon}
                                        destructive={
                                            extendedModerationState.muteChat
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onExtendedModeration?.(
                                                'muteChat',
                                                !extendedModerationState.muteChat
                                            )
                                        }
                                    >
                                        {extendedModerationState.muteChat
                                            ? 'Enable Chatbox'
                                            : 'Disable Chatbox'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onReportHacking}
                                    >
                                        {t('dialog.user.generated.report_hacking')}
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
                <EntityDialogTabContent value="info">
                    {visiblePresenceLocation ? (
                        <div className="border-border mb-2 flex flex-col gap-2 border-b pb-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                {visiblePresenceLocation.includes(':') ? (
                                    <>
                                        <LocationWorld
                                            className="min-w-0"
                                            locationObject={{
                                                ...(locationInstance || {}),
                                                tag: visiblePresenceLocation,
                                                location:
                                                    visiblePresenceLocation,
                                                userId: locationOwnerId,
                                                playerCount:
                                                    locationPlayerCount,
                                                capacity:
                                                    locationInstance?.capacity ??
                                                    locationInstance?.recommendedCapacity
                                            }}
                                            currentUserId={currentUserId}
                                            grouphint={
                                                locationInstance?.groupName ||
                                                profile.$location?.groupName ||
                                                ''
                                            }
                                            endpoint={currentEndpoint}
                                            hint={locationWorldTitle}
                                            instanceClickAction="world"
                                        />
                                        <InstanceActionBar
                                            className="shrink-0"
                                            location={visiblePresenceLocation}
                                            launchLocation={
                                                visiblePresenceLocation
                                            }
                                            inviteLocation={
                                                visiblePresenceLocation
                                            }
                                            instanceLocation={
                                                visiblePresenceLocation
                                            }
                                            instance={locationInstance}
                                            worldName={locationWorldTitle}
                                            friendCount={locationFriendCount}
                                            playerCount={locationPlayerCount}
                                            capacity={
                                                locationInstance?.capacity ??
                                                locationInstance?.recommendedCapacity
                                            }
                                            refreshTooltip={t(
                                                'dialog.user.info.refresh_instance_info'
                                            )}
                                            showHistory={Boolean(
                                                previousInstances.length
                                            )}
                                            onRefresh={onRefreshLocation}
                                            onHistory={() =>
                                                changeTab('instance-history')
                                            }
                                        />
                                    </>
                                ) : (
                                    <Location
                                        location={visiblePresenceLocation}
                                        hint={locationWorldTitle}
                                        enableContextMenu
                                        showLaunchActions
                                    />
                                )}
                            </div>
                            {locationInstanceUsers.length ? (
                                <div className="max-h-36 overflow-auto">
                                    <EntityList
                                        rows={locationInstanceUsers}
                                        kind="user"
                                    />
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    <EntityInfoGrid>
                        {profile.note && !hideUserNotes ? (
                            <EntityInfoBlock
                                label={t('dialog.user.generated.note')}
                                full
                                onClick={onEditMemo}
                            >
                                <pre className="text-muted-foreground max-h-52 font-sans text-xs whitespace-pre-wrap">
                                    {profile.note}
                                </pre>
                            </EntityInfoBlock>
                        ) : null}
                        {memo && !hideUserMemos ? (
                            <EntityInfoBlock
                                label={t('dialog.user.generated.memo')}
                                full
                                onClick={onEditMemo}
                            >
                                <pre className="text-muted-foreground max-h-52 font-sans text-xs whitespace-pre-wrap">
                                    {memo}
                                </pre>
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock label={t('dialog.user.info.avatar_info')} full>
                            {currentAvatarTarget ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="hover:text-primary h-auto justify-start p-0 text-left text-xs"
                                    onClick={() =>
                                        openAvatarDialog(
                                            currentAvatarDialogArgs
                                        )
                                    }
                                >
                                    <UserIcon data-icon="inline-start" />
                                    {currentAvatarDisplayName || 'Avatar'}
                                </Button>
                            ) : (
                                <span className="block truncate text-xs">
                                    —
                                </span>
                            )}
                        </EntityInfoBlock>
                        <EntityInfoBlock label={t('dialog.user.info.represented_group')} full>
                            {representedGroupStatus === 'running' ? (
                                <span className="text-muted-foreground block text-xs">
                                    {t('dialog.user.generated.loading')}
                                </span>
                            ) : representedGroup?.isRepresenting ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="hover:text-primary h-auto max-w-full justify-start gap-2 p-0 text-left text-xs font-normal whitespace-normal text-inherit"
                                    onClick={() =>
                                        openGroupDialog({
                                            groupId: representedGroup.groupId,
                                            title:
                                                representedGroup.name ||
                                                undefined,
                                            seedData: {
                                                ...representedGroup,
                                                $memberId: representedGroup.id,
                                                id: representedGroup.groupId,
                                                myMember: {
                                                    ...(representedGroup.myMember ||
                                                        {}),
                                                    id: representedGroup.id,
                                                    groupId:
                                                        representedGroup.groupId,
                                                    isRepresenting: Boolean(
                                                        representedGroup.isRepresenting
                                                    ),
                                                    isSubscribedToAnnouncements:
                                                        Boolean(
                                                            representedGroup.isSubscribedToAnnouncements
                                                        ),
                                                    visibility:
                                                        representedGroup.visibility ||
                                                        representedGroup.memberVisibility ||
                                                        'visible',
                                                    membershipStatus:
                                                        representedGroup.membershipStatus ||
                                                        ''
                                                }
                                            }
                                        })
                                    }
                                >
                                    {representedGroup.iconUrl ? (
                                        <img
                                            src={convertFileUrlToImageUrl(
                                                representedGroup.iconUrl,
                                                128
                                            )}
                                            alt=""
                                            className="size-10 shrink-0 rounded-md object-cover"
                                        />
                                    ) : null}
                                    <span className="min-w-0">
                                        <span className="block truncate">
                                            {representedGroup.ownerId ===
                                            profile.id
                                                ? 'Owner - '
                                                : ''}
                                            {representedGroup.name || 'Group'}
                                        </span>
                                        <span className="text-muted-foreground block truncate">
                                            {representedGroup.memberCount
                                                ? `${representedGroup.memberCount} members`
                                                : ''}
                                        </span>
                                    </span>
                                </Button>
                            ) : (
                                <span className="text-muted-foreground block text-xs">
                                    —
                                </span>
                            )}
                        </EntityInfoBlock>
                        <EntityInfoBlock label={t('dialog.user.generated.bio')} full>
                            <div className="flex items-start gap-2">
                                <pre className="text-muted-foreground max-h-52 min-w-0 flex-1 overflow-auto font-sans text-xs whitespace-pre-wrap">
                                    {visibleBio}
                                </pre>
                                {profile.bio ? (
                                    <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        className="shrink-0"
                                        disabled={bioTranslationLoading}
                                        title={
                                            translatedBioActive
                                                ? 'Show original bio'
                                                : 'Translate bio'
                                        }
                                        aria-label={
                                            translatedBioActive
                                                ? 'Show original bio'
                                                : 'Translate bio'
                                        }
                                        onClick={() =>
                                            void toggleBioTranslation()
                                        }
                                    >
                                        {bioTranslationLoading ? (
                                            <Spinner data-icon="inline-start" />
                                        ) : (
                                            <LanguagesIcon data-icon="inline-start" />
                                        )}
                                    </Button>
                                ) : null}
                            </div>
                            {bioLinks.length ? (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {bioLinks.map((link) => (
                                        <Button
                                            key={link}
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            title={link}
                                            aria-label={`Open ${link}`}
                                            onClick={() =>
                                                openExternalLink(link)
                                            }
                                        >
                                            {getFaviconUrl(link) ? (
                                                <img
                                                    src={getFaviconUrl(link)}
                                                    alt=""
                                                    className="size-4"
                                                />
                                            ) : (
                                                <ExternalLinkIcon data-icon="inline-start" />
                                            )}
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </EntityInfoBlock>
                        {!isCurrentUser ? (
                            <EntityInfoBlock
                                label={t('dialog.user.generated.last_seen')}
                                value={formatStatsDate(lastSeen)}
                            />
                        ) : null}
                        <EntityInfoBlock
                            label={t('dialog.user.generated.last_login')}
                            value={formatDate(
                                profile.last_login || profile.last_activity
                            )}
                        />
                        <EntityInfoBlock
                            label={t('dialog.user.generated.last_activity')}
                            value={formatDate(profile.last_activity)}
                        />
                        <EntityInfoBlock
                            label={t('dialog.user.generated.date_joined')}
                            value={profile.date_joined}
                        />
                        {isCurrentUser ? (
                            <EntityInfoBlock
                                label={t('dialog.user.info.play_time')}
                                value={formatStatsDuration(userTimeSpent)}
                                onClick={
                                    previousInstances.length
                                        ? () => changeTab('instance-history')
                                        : undefined
                                }
                            />
                        ) : (
                            <>
                                <EntityInfoBlock
                                    label={t('dialog.user.generated.join_count')}
                                    value={
                                        userJoinCount
                                            ? String(userJoinCount)
                                            : '—'
                                    }
                                    onClick={
                                        previousInstances.length
                                            ? () =>
                                                  changeTab('instance-history')
                                            : undefined
                                    }
                                />
                                <EntityInfoBlock
                                    label={t('dialog.user.generated.time_together')}
                                    value={formatStatsDuration(userTimeSpent)}
                                />
                            </>
                        )}
                        {!isCurrentUser ? (
                            <EntityInfoBlock
                                label={t('dialog.user.info.avatar_cloning')}
                                value={
                                    profile.allowAvatarCopying
                                        ? 'Allow'
                                        : 'Deny'
                                }
                            />
                        ) : null}
                        {visibleHomeLocationTarget ? (
                            <EntityInfoBlock label={t('dialog.user.generated.home_location')} full>
                                <Location
                                    location={visibleHomeLocationTarget}
                                    enableContextMenu
                                    showLaunchActions
                                />
                            </EntityInfoBlock>
                        ) : null}
                        <EntityInfoBlock label={t('dialog.user.generated.user_id')} mono full>
                            <span className="block truncate font-mono text-xs">
                                {profile.id || '—'}
                                {profile.id ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                type="button"
                                                aria-label={"Open user copy menu"}
                                                title={t('dialog.user.generated.copy_user_details')}
                                                className="ml-1"
                                                size="icon-xs"
                                                variant="ghost"
                                                onClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                <CopyIcon data-icon="inline-start" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                            <DropdownMenuGroup>
                                                <DropdownMenuItem
                                                    onSelect={() =>
                                                        void copyUserText(
                                                            profile.id,
                                                            'User ID'
                                                        )
                                                    }
                                                >
                                                    {t('dialog.user.generated.copy_user_id')}
                                                </DropdownMenuItem>
                                                {profile.displayName ? (
                                                    <DropdownMenuItem
                                                        onSelect={() =>
                                                            void copyUserText(
                                                                profile.displayName,
                                                                'Display name'
                                                            )
                                                        }
                                                    >
                                                        {t('dialog.user.generated.copy_display_name')}
                                                    </DropdownMenuItem>
                                                ) : null}
                                            </DropdownMenuGroup>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : null}
                            </span>
                        </EntityInfoBlock>
                    </EntityInfoGrid>
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="mutual"
                    className="flex flex-col gap-2"
                >
                    <SearchHeader
                        searchKey="mutual"
                        tab="mutual"
                        rows={mutualFriends}
                        filteredRows={filteredMutualFriends}
                        placeholder={t('dialog.user.generated.search_mutual_friends')}
                    >
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.generated.sort_by')}
                        </span>
                        <Select
                            value={mutualSort}
                            onValueChange={setMutualSort}
                            disabled={remoteStatus.mutual === 'running'}
                        >
                            <SelectTrigger size="sm" className="w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {Object.entries(
                                        userDialogMutualFriendSortingOptions
                                    ).map(([key, option]) => (
                                        <SelectItem
                                            key={key}
                                            value={option.value}
                                        >
                                            {t(option.name)}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </SearchHeader>
                    <EntityList
                        rows={visibleMutualFriends}
                        kind="user"
                        loading={remoteStatus.mutual === 'running'}
                        error={remoteErrors.mutual}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="groups"
                    className="flex flex-col gap-2"
                >
                    <SearchHeader
                        searchKey="groups"
                        tab="groups"
                        rows={profileGroups}
                        filteredRows={filteredProfileGroups}
                        placeholder={t('dialog.user.generated.search_groups')}
                    >
                        {!groupEditMode ? (
                            <>
                                <span className="text-muted-foreground text-sm">
                                    {t('dialog.user.generated.sort_by')}
                                </span>
                                <Select
                                    value={effectiveGroupSort}
                                    onValueChange={setGroupSort}
                                    disabled={remoteStatus.groups === 'running'}
                                >
                                    <SelectTrigger size="sm" className="w-36">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {Object.entries(
                                                userDialogGroupSortingOptions
                                            ).map(([key, option]) => (
                                                <SelectItem
                                                    key={key}
                                                    value={option.value}
                                                    disabled={
                                                        option.value ===
                                                            'inGame' &&
                                                        !isCurrentUser
                                                    }
                                                >
                                                    {t(option.name)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </>
                        ) : null}
                        {isCurrentUser ? (
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={
                                        groupEditMode ? 'secondary' : 'outline'
                                    }
                                    disabled={
                                        groupActionId === '__bulk_groups__'
                                    }
                                    onClick={() => {
                                        const nextGroupEditMode =
                                            !groupEditMode;
                                        setGroupEditMode(nextGroupEditMode);
                                        if (nextGroupEditMode) {
                                            setGroupSort('inGame');
                                        }
                                        clearSelectedGroups();
                                    }}
                                >
                                    {groupEditMode ? 'Done' : 'Edit'}
                                </Button>
                                {groupEditMode ? (
                                    <>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                groupActionId ===
                                                    '__bulk_groups__' ||
                                                !filteredProfileGroups.length
                                            }
                                            onClick={() =>
                                                selectVisibleGroups(
                                                    filteredProfileGroups
                                                )
                                            }
                                        >
                                            {t('dialog.user.generated.select_visible')}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                groupActionId ===
                                                    '__bulk_groups__' ||
                                                !selectedGroupCount
                                            }
                                            onClick={clearSelectedGroups}
                                        >
                                            {t('dialog.user.generated.clear_selected')}
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={
                                                        groupActionId ===
                                                        '__bulk_groups__'
                                                    }
                                                >
                                                    <SettingsIcon data-icon="inline-start" />
                                                    {t('dialog.user.generated.bulk_actions')}
                                                    {selectedGroupCount ? (
                                                        <span className="text-muted-foreground text-xs">
                                                            (
                                                            {selectedGroupCount}
                                                            )
                                                        </span>
                                                    ) : null}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start">
                                                <DropdownMenuGroup>
                                                    <DropdownMenuItem
                                                        disabled={
                                                            !selectedGroupCount
                                                        }
                                                        onSelect={() =>
                                                            void changeSelectedGroupsVisibility(
                                                                'visible'
                                                            )
                                                        }
                                                    >
                                                        <EyeIcon />
                                                        {t('dialog.user.generated.set_selected_visible')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        disabled={
                                                            !selectedGroupCount
                                                        }
                                                        onSelect={() =>
                                                            void changeSelectedGroupsVisibility(
                                                                'hidden'
                                                            )
                                                        }
                                                    >
                                                        <EyeIcon />
                                                        {t('dialog.user.generated.set_selected_hidden')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        disabled={
                                                            !selectedGroupCount
                                                        }
                                                        onSelect={() =>
                                                            void changeSelectedGroupsVisibility(
                                                                'friends'
                                                            )
                                                        }
                                                    >
                                                        <UsersIcon />
                                                        {t('dialog.user.generated.set_selected_friends')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onSelect={() =>
                                                            exportUserGroups(
                                                                selectedUserGroups
                                                            )
                                                        }
                                                    >
                                                        <DownloadIcon />
                                                        {t('dialog.user.generated.export')}{' '}
                                                        {selectedGroupCount
                                                            ? 'Selected'
                                                            : 'All'}{' '}
                                                        {t('dialog.user.generated.groups')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        variant="destructive"
                                                        disabled={
                                                            !selectedGroupCount
                                                        }
                                                        onSelect={() =>
                                                            void leaveSelectedGroups()
                                                        }
                                                    >
                                                        <LogOutIcon />
                                                        {t('dialog.user.generated.leave_selected')}
                                                    </DropdownMenuItem>
                                                </DropdownMenuGroup>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </>
                                ) : null}
                            </>
                        ) : null}
                    </SearchHeader>
                    {remoteStatus.groups === 'running' ||
                    remoteErrors.groups ? (
                        <EntityList
                            rows={filteredProfileGroups}
                            kind="group"
                            loading={remoteStatus.groups === 'running'}
                            error={remoteErrors.groups}
                        />
                    ) : groupSearchActive ? (
                        <EntityList
                            rows={filteredProfileGroups}
                            kind="group"
                            editableGroups={isCurrentUser && groupEditMode}
                            selectableGroups={groupEditMode}
                            selectedGroupIds={selectedGroupIds}
                            groupActionId={groupActionId}
                            onGroupVisibilityChange={(group, visibility) =>
                                void changeGroupVisibility(group, visibility)
                            }
                            onGroupLeave={(group) => void leaveUserGroup(group)}
                            onGroupMove={
                                groupEditMode
                                    ? (group, direction) =>
                                          void moveGroupInGameOrder(
                                              group,
                                              direction
                                          )
                                    : undefined
                            }
                            onGroupSelectionChange={setGroupSelected}
                        />
                    ) : userGroupSections.ownGroups.length ||
                      userGroupSections.mutualGroups.length ||
                      userGroupSections.remainingGroups.length ? (
                        <div className="flex flex-col gap-4">
                            <UserGroupSection
                                title={t('dialog.user.groups.own_groups')}
                                rows={userGroupSections.ownGroups}
                                countText={ownGroupCountText}
                                editableGroups={isCurrentUser && groupEditMode}
                                selectableGroups={groupEditMode}
                                selectedGroupIds={selectedGroupIds}
                                groupActionId={groupActionId}
                                onGroupVisibilityChange={(group, visibility) =>
                                    void changeGroupVisibility(
                                        group,
                                        visibility
                                    )
                                }
                                onGroupLeave={(group) =>
                                    void leaveUserGroup(group)
                                }
                                onGroupMove={
                                    groupEditMode
                                        ? (group, direction) =>
                                              void moveGroupInGameOrder(
                                                  group,
                                                  direction
                                              )
                                        : undefined
                                }
                                onGroupSelectionChange={setGroupSelected}
                            />
                            <UserGroupSection
                                title={t('dialog.user.groups.mutual_groups')}
                                rows={userGroupSections.mutualGroups}
                                editableGroups={isCurrentUser && groupEditMode}
                                selectableGroups={groupEditMode}
                                selectedGroupIds={selectedGroupIds}
                                groupActionId={groupActionId}
                                onGroupVisibilityChange={(group, visibility) =>
                                    void changeGroupVisibility(
                                        group,
                                        visibility
                                    )
                                }
                                onGroupLeave={(group) =>
                                    void leaveUserGroup(group)
                                }
                                onGroupMove={
                                    groupEditMode
                                        ? (group, direction) =>
                                              void moveGroupInGameOrder(
                                                  group,
                                                  direction
                                              )
                                        : undefined
                                }
                                onGroupSelectionChange={setGroupSelected}
                            />
                            <UserGroupSection
                                title={t('dialog.user.groups.groups')}
                                rows={userGroupSections.remainingGroups}
                                countText={remainingGroupCountText}
                                editableGroups={isCurrentUser && groupEditMode}
                                selectableGroups={groupEditMode}
                                selectedGroupIds={selectedGroupIds}
                                groupActionId={groupActionId}
                                onGroupVisibilityChange={(group, visibility) =>
                                    void changeGroupVisibility(
                                        group,
                                        visibility
                                    )
                                }
                                onGroupLeave={(group) =>
                                    void leaveUserGroup(group)
                                }
                                onGroupMove={
                                    groupEditMode
                                        ? (group, direction) =>
                                              void moveGroupInGameOrder(
                                                  group,
                                                  direction
                                              )
                                        : undefined
                                }
                                onGroupSelectionChange={setGroupSelected}
                            />
                        </div>
                    ) : (
                        <EntityBlank />
                    )}
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="worlds"
                    className="flex flex-col gap-4"
                >
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="text-muted-foreground text-sm">
                                {filteredProfileWorlds.length}/
                                {profileWorlds.length}
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={remoteStatus.worlds === 'running'}
                                onClick={() =>
                                    void loadTab('worlds', { force: true })
                                }
                            >
                                {t('common.actions.refresh')}
                            </Button>
                            <Input
                                value={search.worlds}
                                onChange={(event) =>
                                    setSearch((current) => ({
                                        ...current,
                                        worlds: event.target.value
                                    }))
                                }
                                placeholder={t('dialog.user.generated.search_worlds')}
                                className="ml-auto h-8 w-40"
                            />
                            <span className="text-muted-foreground text-sm">
                                {t('dialog.user.generated.sort_by')}
                            </span>
                            <Select
                                value={worldSort}
                                onValueChange={changeWorldSort}
                                disabled={remoteStatus.worlds === 'running'}
                            >
                                <SelectTrigger size="sm" className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="name">
                                            {t('dialog.user.generated.name')}
                                        </SelectItem>
                                        <SelectItem value="updated">
                                            {t('dialog.user.generated.updated')}
                                        </SelectItem>
                                        <SelectItem value="created">
                                            {t('dialog.user.generated.created')}
                                        </SelectItem>
                                        <SelectItem value="favorites">
                                            {t('dialog.user.generated.favorites')}
                                        </SelectItem>
                                        <SelectItem value="popularity">
                                            {t('dialog.user.generated.popularity')}
                                        </SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <span className="text-muted-foreground text-sm">
                                {t('dialog.user.generated.order_by')}
                            </span>
                            <Select
                                value={worldOrder}
                                onValueChange={changeWorldOrder}
                                disabled={remoteStatus.worlds === 'running'}
                            >
                                <SelectTrigger size="sm" className="w-36">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="descending">
                                            {t('dialog.user.worlds.order.descending')}
                                        </SelectItem>
                                        <SelectItem value="ascending">
                                            {t('dialog.user.worlds.order.ascending')}
                                        </SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <EntityList
                            rows={filteredProfileWorlds}
                            kind="world"
                            loading={remoteStatus.worlds === 'running'}
                            error={remoteErrors.worlds}
                        />
                    </div>
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="favorite-worlds"
                    className="flex flex-col gap-2"
                >
                    <SearchHeader
                        searchKey="favoriteWorlds"
                        tab="favorite-worlds"
                        rows={favoriteWorlds}
                        filteredRows={filteredFavoriteWorlds}
                        placeholder={t('dialog.user.generated.search_favorite_worlds')}
                    />
                    <FavoriteWorldGroups
                        groups={remoteData.favoriteWorldGroups}
                        rows={favoriteWorlds}
                        search={search.favoriteWorlds}
                        filteredRows={filteredFavoriteWorlds}
                        loading={remoteStatus['favorite-worlds'] === 'running'}
                        error={remoteErrors['favorite-worlds']}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="avatars"
                    className="flex flex-col gap-2"
                >
                    {currentAvatarTarget ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-primary h-auto justify-start p-0 text-left"
                            onClick={() =>
                                openAvatarDialog(currentAvatarDialogArgs)
                            }
                        >
                            <UserIcon data-icon="inline-start" />
                            {t('dialog.user.generated.current_avatar')}{' '}
                            {currentAvatarDisplayName || 'Avatar'}
                        </Button>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-muted-foreground text-sm">
                            {visibleProfileAvatars.length}/
                            {profileAvatars.length}
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={remoteStatus.avatars === 'running'}
                            onClick={() =>
                                void loadTab('avatars', { force: true })
                            }
                        >
                            {t('common.actions.refresh')}
                        </Button>
                        <Input
                            value={search.avatars}
                            onChange={(event) =>
                                setSearch((current) => ({
                                    ...current,
                                    avatars: event.target.value
                                }))
                            }
                            placeholder={t('dialog.user.generated.search_avatars')}
                            className="ml-auto h-8 w-40"
                        />
                        {profile.id === currentUserId ? (
                            <>
                                <span className="text-muted-foreground text-sm">
                                    {t('dialog.user.generated.sort_by')}
                                </span>
                                <Select
                                    value={avatarSort}
                                    onValueChange={changeAvatarSort}
                                    disabled={
                                        remoteStatus.avatars === 'running'
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-36">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="name">
                                                {t('dialog.user.generated.name')}
                                            </SelectItem>
                                            <SelectItem value="update">
                                                {t('dialog.user.generated.updated')}
                                            </SelectItem>
                                            <SelectItem value="createdAt">
                                                {t('dialog.user.avatars.sort_by_uploaded')}
                                            </SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <span className="text-muted-foreground text-sm">
                                    {t('dialog.user.generated.group_by')}
                                </span>
                                <Select
                                    value={avatarReleaseStatus}
                                    onValueChange={changeAvatarReleaseStatus}
                                    disabled={
                                        remoteStatus.avatars === 'running'
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="all">
                                                {t('dialog.user.generated.all')}
                                            </SelectItem>
                                            <SelectItem value="public">
                                                {t('dialog.user.generated.public')}
                                            </SelectItem>
                                            <SelectItem value="private">
                                                {t('dialog.user.generated.private')}
                                            </SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </>
                        ) : null}
                    </div>
                    <EntityList
                        rows={visibleProfileAvatars}
                        kind="avatar"
                        loading={remoteStatus.avatars === 'running'}
                        error={remoteErrors.avatars}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="instance-history"
                    className="flex min-h-0 flex-col"
                >
                    <PreviousInstancesPanel
                        title={t('dialog.previous_instances.header')}
                        instances={previousInstances}
                        variant="user"
                        targetRef={profile}
                        onRowsChange={onPreviousInstancesChange}
                        className="flex-1"
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent
                    value="activity"
                    className="flex flex-col gap-4"
                >
                    <UserActivityPanel
                        profile={profile}
                        isCurrentUser={isCurrentUser}
                        active={activeTab === 'activity'}
                    />
                </EntityDialogTabContent>
                <EntityDialogTabContent value="json">
                    <EntityRawJson
                        value={{
                            profile,
                            memo,
                            moderationState,
                            isFriend,
                            isFavorite
                        }}
                    />
                </EntityDialogTabContent>
            </EntityDialogTabs>
        </EntityDialogScaffold>
    );
}
