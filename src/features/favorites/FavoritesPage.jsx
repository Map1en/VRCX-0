import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowUpDownIcon,
    CopyIcon,
    GlobeIcon,
    ImageIcon,
    LoaderCircleIcon,
    LockIcon,
    DownloadIcon,
    EllipsisIcon,
    MoreHorizontalIcon,
    PlusIcon,
    RefreshCcwIcon,
    RefreshCwIcon,
    SearchIcon,
    Trash2Icon,
    TriangleAlertIcon,
    UploadIcon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { cn } from '@/lib/utils.js';
import { convertFileUrlToImageUrl, userImage } from '@/lib/entityMedia.js';
import { formatCsvRow } from '@/shared/utils/csv.js';
import {
    avatarProfileRepository,
    configRepository,
    localFavoritesRepository,
    notificationRepository,
    vrchatSearchRepository,
    vrchatFavoriteRepository
} from '@/repositories/index.js';
import { openAvatarDialog, openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { database } from '@/services/database/index.js';
import { bootstrapFavorites } from '@/services/favoriteBootstrapService.js';
import { openFavoriteImportDialog } from '@/services/favoriteImportService.js';
import { setBoolConfigPreference } from '@/services/preferencesService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import { parseLocation, resolveFriendPresenceLocation } from '@/shared/utils/location.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/shadcn/resizable.jsx';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import { Switch } from '@/ui/shadcn/switch.jsx';
import { Textarea } from '@/ui/shadcn/textarea.jsx';

import {
    clearFavoriteRemoteDetailsCache,
    useFavoriteRemoteDetails
} from './useFavoriteRemoteDetails.js';

const VISIBILITY_OPTIONS = ['public', 'friends', 'private'];
const EMPTY_ITEMS = Object.freeze([]);
const SPLITTER_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendSplitter',
    world: 'VRCX_FavoritesWorldSplitter',
    avatar: 'VRCX_FavoritesAvatarSplitter'
};
const SPLITTER_DEFAULT_SIZE_PX = 260;
const SPLITTER_MIN_SIZE_PX = 0;
const SPLITTER_MAX_SIZE_PX = 520;
const SPLITTER_FALLBACK_WIDTH = 1200;
const CARD_SCALE_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendCardScale',
    world: 'VRCX_FavoritesWorldCardScale',
    avatar: 'VRCX_FavoritesAvatarCardScale'
};
const CARD_SPACING_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendCardSpacing',
    world: 'VRCX_FavoritesWorldCardSpacing',
    avatar: 'VRCX_FavoritesAvatarCardSpacing'
};
const CARD_SCALE_SLIDER = { min: 0.6, max: 1, step: 0.01 };
const CARD_SPACING_SLIDER = { min: 0.5, max: 1.5, step: 0.05 };
const EXPORT_ALL_VALUE = '__all__';
const EXPORT_NONE_VALUE = '__none__';
const FAVORITE_EXPORT_FIELD_OPTIONS = Object.freeze({
    friend: Object.freeze([
        { label: 'ID', value: 'id' },
        { label: 'Name', value: 'name' },
        { label: 'Status', value: 'status' },
        { label: 'Group', value: 'group' },
        { label: 'Source', value: 'source' }
    ]),
    entity: Object.freeze([
        { label: 'ID', value: 'id' },
        { label: 'Name', value: 'name' },
        { label: 'Author', value: 'author' },
        { label: 'Thumbnail', value: 'thumbnail' },
        { label: 'Group', value: 'group' },
        { label: 'Source', value: 'source' }
    ])
});

function normalizeSearchValue(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = normalizeEntityId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeEntityId(gameState?.currentDestination);
    }

    return (
        currentLocation ||
        normalizeEntityId(gameState?.currentDestination) ||
        normalizeEntityId(currentUserSnapshot?.$locationTag || currentUserSnapshot?.location)
    );
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function clampSplitterSizePx(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return SPLITTER_DEFAULT_SIZE_PX;
    }
    return Math.min(SPLITTER_MAX_SIZE_PX, Math.max(SPLITTER_MIN_SIZE_PX, Math.round(parsed)));
}

function pxToSplitterPercent(value, width) {
    const parsedWidth = Number(width);
    const safeWidth = Number.isFinite(parsedWidth) && parsedWidth > 0
        ? parsedWidth
        : SPLITTER_FALLBACK_WIDTH;
    return Math.min(100, Math.max(0, (Number(value) / safeWidth) * 100));
}

function splitterPercentToPx(value, width) {
    const parsedWidth = Number(width);
    const safeWidth = Number.isFinite(parsedWidth) && parsedWidth > 0
        ? parsedWidth
        : SPLITTER_FALLBACK_WIDTH;
    return clampSplitterSizePx((Number(value) / 100) * safeWidth);
}

function sortItems(items, sortValue) {
    return [...items].sort((left, right) => {
        if (sortValue === 'players') {
            const playerDelta = (right.playerCount || 0) - (left.playerCount || 0);
            if (playerDelta !== 0) {
                return playerDelta;
            }
            return 0;
        }

        if (sortValue === 'date') {
            const orderDelta =
                (left.orderIndex ?? Number.MAX_SAFE_INTEGER) -
                (right.orderIndex ?? Number.MAX_SAFE_INTEGER);
            if (orderDelta !== 0) {
                return orderDelta;
            }
        }

        const titleDelta = String(left.title || '').localeCompare(String(right.title || ''), undefined, {
            sensitivity: 'base'
        });
        if (titleDelta !== 0) {
            return titleDelta;
        }

        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

function shrinkImage(url) {
    const normalized = convertFileUrlToImageUrl(url, 128);
    if (typeof normalized !== 'string' || !normalized) {
        return '';
    }
    return normalized.includes('/256') ? normalized.replace('/256', '/128') : normalized;
}

function getFavoriteExportFieldOptions(kind) {
    return kind === 'friend'
        ? FAVORITE_EXPORT_FIELD_OPTIONS.friend
        : FAVORITE_EXPORT_FIELD_OPTIONS.entity;
}

function buildFavoriteExportCsv(items, kind, selectedFields = null) {
    const options = getFavoriteExportFieldOptions(kind);
    const optionByValue = Object.fromEntries(options.map((option) => [option.value, option]));
    const fields = (Array.isArray(selectedFields) && selectedFields.length ? selectedFields : options.map((option) => option.value))
        .filter((field) => optionByValue[field]);
    const labels = fields.map((field) => optionByValue[field].label);
    const lines = [labels.join(',')];

    for (const item of items) {
        lines.push(formatCsvRow({
            id: item.id,
            name: item.title,
            status: item.statusLabel || item.subtitle || '',
            author: item.subtitle || '',
            thumbnail: item.imageUrl || '',
            group: item.groupLabel || item.groupKey || '',
            source: item.source || ''
        }, fields));
    }

    return lines.join('\n');
}

function FavoriteExportDialog({
    open,
    onOpenChange,
    kind,
    remoteGroups,
    localGroups,
    remoteItemsByGroup,
    localItemsByGroup
}) {
    const fieldOptions = getFavoriteExportFieldOptions(kind);
    const [selectedFields, setSelectedFields] = useState(() => fieldOptions.map((option) => option.value));
    const [remoteGroupKey, setRemoteGroupKey] = useState(EXPORT_ALL_VALUE);
    const [localGroupKey, setLocalGroupKey] = useState(EXPORT_NONE_VALUE);
    const items = useMemo(() => {
        const remoteItems =
            remoteGroupKey === EXPORT_ALL_VALUE
                ? Object.values(remoteItemsByGroup || {}).flat()
                : remoteItemsByGroup?.[remoteGroupKey] || [];
        const localItems =
            localGroupKey === EXPORT_NONE_VALUE
                ? []
                : localItemsByGroup?.[localGroupKey] || [];

        return [...remoteItems, ...localItems];
    }, [localGroupKey, localItemsByGroup, remoteGroupKey, remoteItemsByGroup]);
    const content = useMemo(
        () => buildFavoriteExportCsv(items, kind, selectedFields),
        [items, kind, selectedFields]
    );

    useEffect(() => {
        if (open) {
            setSelectedFields(fieldOptions.map((option) => option.value));
            setRemoteGroupKey(EXPORT_ALL_VALUE);
            setLocalGroupKey(EXPORT_NONE_VALUE);
        }
    }, [fieldOptions, open]);

    function toggleField(field, checked) {
        setSelectedFields((current) => {
            if (checked) {
                return Array.from(new Set([...current, field]));
            }
            return current.filter((entry) => entry !== field);
        });
    }

    async function copyExportContent() {
        try {
            await navigator.clipboard.writeText(content);
            toast.success('Copied favorite export data.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to copy favorite export data.');
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Export favorite {kind}s</DialogTitle>
                    <DialogDescription>
                        Review the CSV content before copying it to the clipboard.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-3">
                    {fieldOptions.map((option) => (
                        <label key={option.value} className="inline-flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={selectedFields.includes(option.value)}
                                onCheckedChange={(checked) => toggleField(option.value, Boolean(checked))}
                            />
                            <span>{option.label}</span>
                        </label>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={remoteGroupKey} onValueChange={setRemoteGroupKey}>
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue placeholder="VRChat group" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={EXPORT_ALL_VALUE}>All VRChat favorites</SelectItem>
                                {remoteGroups.map((group) => (
                                    <SelectItem key={group.key} value={group.key}>
                                        {group.label} ({group.capacity ? `${group.count}/${group.capacity}` : group.count})
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Select value={localGroupKey} onValueChange={setLocalGroupKey}>
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue placeholder="Local group" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={EXPORT_NONE_VALUE}>No local group</SelectItem>
                                {localGroups.map((group) => (
                                    <SelectItem key={group.key} value={group.key}>
                                        {group.label} ({group.count})
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">{items.length} item(s)</span>
                </div>
                <Textarea
                    readOnly
                    rows={16}
                    value={content}
                    className="min-h-80 resize-none font-mono text-xs"
                    onClick={(event) => event.currentTarget.select()}
                />
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button type="button" disabled={!items.length || !selectedFields.length} onClick={() => void copyExportContent()}>
                        Copy
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function favoriteGroupType(kind, group) {
    if (group?.type) {
        return group.type;
    }
    if (kind === 'world') {
        return 'world';
    }
    return kind;
}

function FavoritesToolbar({
    kind,
    sortValue,
    searchQuery,
    searchPlaceholder,
    searchMode,
    cardScale,
    cardSpacing,
    refreshing,
    onSortValueChange,
    onSearchChange,
    onSearchModeChange,
    onCardScaleChange,
    onCardSpacingChange,
    onRefresh,
    onImport,
    onExport
}) {
    const cardScalePercent = Math.round(cardScale * 100);
    const cardSpacingPercent = Math.round(cardSpacing * 100);

    return (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Select value={sortValue} onValueChange={onSortValueChange}>
                <SelectTrigger size="sm" className="min-w-[200px]">
                    <span className="flex items-center gap-2">
                        <ArrowUpDownIcon className="size-4" />
                        <SelectValue placeholder="Sort favorites" />
                    </span>
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value="name">Sort by name</SelectItem>
                        <SelectItem value="date">Sort by date</SelectItem>
                        {kind === 'world' ? <SelectItem value="players">Sort by players</SelectItem> : null}
                    </SelectGroup>
                </SelectContent>
            </Select>

            <div className="flex min-w-[280px] flex-1 items-center gap-2">
                <div className="relative flex-1">
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchQuery}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={searchPlaceholder}
                        className="h-8 pl-9 pr-20 text-sm"
                    />
                    {kind === 'world' ? (
                        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 rounded-md border bg-background p-0.5">
                            <Button
                                type="button"
                                size="xs"
                                variant={searchMode === 'name' ? 'default' : 'ghost'}
                                className="h-5 px-1.5 text-[11px]"
                                onClick={() => onSearchModeChange('name')}>
                                Name
                            </Button>
                            <Button
                                type="button"
                                size="xs"
                                variant={searchMode === 'tag' ? 'default' : 'ghost'}
                                className="h-5 px-1.5 text-[11px]"
                                onClick={() => onSearchModeChange('tag')}>
                                Tag
                            </Button>
                        </div>
                    ) : searchQuery ? (
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            className="absolute right-1 top-1/2 -translate-y-1/2"
                            onClick={() => onSearchChange('')}>
                            <XIcon className="size-3" />
                        </Button>
                    ) : null}
                </div>

                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full"
                    disabled={refreshing}
                    onClick={onRefresh}>
                    {refreshing ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon-sm" variant="ghost" className="rounded-full">
                            <EllipsisIcon className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <div className="min-w-[220px] px-3 py-2" onClick={(event) => event.stopPropagation()}>
                            <div className="mb-2 flex items-center justify-between text-[13px] font-semibold">
                                <span>Scale</span>
                                <span className="text-xs text-muted-foreground">{cardScalePercent}%</span>
                            </div>
                            <input
                                type="range"
                                min={CARD_SCALE_SLIDER.min}
                                max={CARD_SCALE_SLIDER.max}
                                step={CARD_SCALE_SLIDER.step}
                                value={cardScale}
                                className="w-full"
                                onChange={(event) => onCardScaleChange(event.target.value)}
                            />
                        </div>
                        <div className="min-w-[220px] px-3 py-2" onClick={(event) => event.stopPropagation()}>
                            <div className="mb-2 flex items-center justify-between text-[13px] font-semibold">
                                <span>Spacing</span>
                                <span className="text-xs text-muted-foreground">{cardSpacingPercent}%</span>
                            </div>
                            <input
                                type="range"
                                min={CARD_SPACING_SLIDER.min}
                                max={CARD_SPACING_SLIDER.max}
                                step={CARD_SPACING_SLIDER.step}
                                value={cardSpacing}
                                className="w-full"
                                onChange={(event) => onCardSpacingChange(event.target.value)}
                            />
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                onImport();
                            }}>
                            <UploadIcon className="size-4" />
                            Import
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                onExport();
                            }}>
                            <DownloadIcon className="size-4" />
                            Export
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

function FavoritesEmptyState({ title, description }) {
    return (
        <div className="flex h-full min-h-60 items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-2">
                <div className="text-[13px] font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function FavoritesLoadingState({ title }) {
    return (
        <div className="flex h-full min-h-60 items-center justify-center">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-5 animate-spin" />
                <span>{title}</span>
            </div>
        </div>
    );
}

function GroupMenu({
    group,
    onRemoteRename,
    onRemoteVisibility,
    onRemoteClear,
    onLocalRename,
    onLocalDelete,
    onHistoryClear
}) {
    if (group.source === 'history') {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-xs" variant="ghost" className="rounded-full" onClick={(event) => event.stopPropagation()}>
                        <EllipsisIcon className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="w-44">
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={(event) => {
                            event.preventDefault();
                            onHistoryClear(group);
                        }}>
                        Clear
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    if (group.source === 'remote') {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-xs" variant="ghost" className="rounded-full" onClick={(event) => event.stopPropagation()}>
                        <MoreHorizontalIcon className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="w-52">
                    <DropdownMenuItem
                        onSelect={(event) => {
                            event.preventDefault();
                            onRemoteRename(group);
                        }}>
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Visibility</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-40">
                            {VISIBILITY_OPTIONS.map((visibility) => (
                                <DropdownMenuCheckboxItem
                                    key={visibility}
                                    checked={group.visibility === visibility}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onRemoteVisibility(group, visibility);
                                    }}>
                                    {visibility}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={(event) => {
                            event.preventDefault();
                            onRemoteClear(group);
                        }}>
                        Clear
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-xs" variant="ghost" className="rounded-full" onClick={(event) => event.stopPropagation()}>
                    <EllipsisIcon className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuItem
                    onSelect={(event) => {
                        event.preventDefault();
                        onLocalRename(group);
                    }}>
                    Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                    variant="destructive"
                    onSelect={(event) => {
                        event.preventDefault();
                        onLocalDelete(group);
                    }}>
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function GroupRailSection({
    title,
    groups,
    selectedSource,
    selectedGroupKey,
    loading,
    creating,
    newGroupName,
    showNewGroup,
    onRefresh,
    onSelect,
    onStartCreate,
    onNewGroupNameChange,
    onConfirmCreate,
    onCancelCreate,
    onRemoteRename,
    onRemoteVisibility,
    onRemoteClear,
    onLocalRename,
    onLocalDelete,
    onHistoryClear
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="mb-[9px] flex items-center justify-between text-sm font-semibold">
                <span>{title}</span>
                {onRefresh ? (
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="rounded-full"
                        disabled={loading}
                        onClick={onRefresh}>
                        {loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCcwIcon className="size-4" />}
                    </Button>
                ) : null}
            </div>
            <div className="flex flex-col gap-2">
                {loading && !groups.length ? (
                    Array.from({ length: 5 }, (_, index) => (
                        <div
                            key={`group-placeholder-${index}`}
                            className="pointer-events-none flex w-full items-start justify-between rounded-lg border border-border px-3 py-2 text-left text-[13px] opacity-70">
                            <div className="min-w-0">
                                <div className="truncate font-semibold">Group {index + 1}</div>
                                <div className="mt-1 h-3 w-14 rounded bg-muted" />
                            </div>
                        </div>
                    ))
                ) : groups.length ? (
                    groups.map((group) => {
                        const isActive = selectedSource === group.source && selectedGroupKey === group.key;
                        return (
                            <div
                                key={`${group.source}:${group.key}`}
                                role="button"
                                tabIndex={0}
                                className={cn(
                                    'flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted',
                                    isActive ? 'border-primary bg-primary/5' : 'border-border'
                                )}
                                onClick={() => onSelect(group)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        onSelect(group);
                                    }
                                }}>
                                <div className="min-w-0">
                                    <div className="truncate font-semibold">{group.label}</div>
                                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        {group.visibility ? <span>{group.visibility}</span> : null}
                                        {group.capacity ? <span>{group.count}/{group.capacity}</span> : <span>{group.count}</span>}
                                    </div>
                                </div>
                                <GroupMenu
                                    group={group}
                                    onRemoteRename={onRemoteRename}
                                    onRemoteVisibility={onRemoteVisibility}
                                    onRemoteClear={onRemoteClear}
                                    onLocalRename={onLocalRename}
                                    onLocalDelete={onLocalDelete}
                                    onHistoryClear={onHistoryClear}
                                />
                            </div>
                        );
                    })
                ) : (
                    <div className="py-3 text-center text-xs text-muted-foreground">No data</div>
                )}
                {showNewGroup && !creating ? (
                    <button
                        type="button"
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                        disabled={loading}
                        onClick={onStartCreate}>
                        <PlusIcon className="size-4" />
                        <span>New Group</span>
                    </button>
                ) : null}
                {showNewGroup && creating ? (
                    <Input
                        value={newGroupName}
                        autoFocus
                        className="h-8 text-sm"
                        disabled={loading}
                        placeholder="New Group"
                        onChange={(event) => onNewGroupNameChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                onConfirmCreate();
                            } else if (event.key === 'Escape') {
                                onCancelCreate();
                            }
                        }}
                        onBlur={onCancelCreate}
                    />
                ) : null}
            </div>
        </div>
    );
}

function FavoritesContentHeader({
    title,
    subtitle,
    editMode,
    editModeDisabled,
    editModeVisible,
    isAllSelected,
    hasSelection,
    showCopyButton,
    onEditModeChange,
    onToggleSelectAll,
    onClearSelection,
    onCopySelection,
    onBulkRemove
}) {
    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5 pl-0.5 text-base font-semibold">
                    <span>{title}</span>
                    {subtitle ? <small className="text-xs font-normal text-muted-foreground">{subtitle}</small> : null}
                </div>
                <div className="flex items-center gap-2 text-[13px]">
                    <span>Edit mode</span>
                    <Switch
                        checked={editMode}
                        disabled={editModeDisabled}
                        onCheckedChange={onEditModeChange}
                    />
                </div>
            </div>
            <div className="flex items-center justify-end">
                {editModeVisible ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={onToggleSelectAll}>
                            {isAllSelected ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={!hasSelection} onClick={onClearSelection}>
                            Clear
                        </Button>
                        {showCopyButton ? (
                            <Button type="button" size="sm" variant="outline" disabled={!hasSelection} onClick={onCopySelection}>
                                <CopyIcon className="size-4" />
                                Copy
                            </Button>
                        ) : null}
                        <Button type="button" size="sm" variant="outline" disabled={!hasSelection} onClick={onBulkRemove}>
                            <Trash2Icon className="size-4" />
                            Bulk Unfavorite
                        </Button>
                    </div>
                ) : null}
            </div>
        </>
    );
}

function FavoriteCard({
    item,
    editMode,
    selected,
    showGroupLabel,
    cardScale = 1,
    cardSpacing = 1,
    removing = false,
    onToggleSelect,
    onRemoveLocal,
    onRemoveRemote,
    canSendInvite = false,
    canBoop = false,
    currentUserId = '',
    currentAvatarId = '',
    onFriendLaunch,
    onFriendSelfInvite,
    onFriendInvite,
    onFriendRequestInvite,
    onFriendBoop,
    onWorldNewInstance,
    onWorldSelfInvite,
    onAvatarSelect
}) {
    const Icon = item.kind === 'friend' ? UserIcon : item.kind === 'world' ? GlobeIcon : ImageIcon;
    const openHandler =
        item.kind === 'friend'
            ? () =>
                openUserDialog({
                    userId: item.id,
                    title: item.title || undefined,
                    seedData: item.seedData ?? null
                })
            : item.kind === 'world'
                ? () =>
                    openWorldDialog({
                        worldId: item.id,
                        title: item.title || undefined,
                        seedData: item.seedData ?? null
                    })
                : item.kind === 'avatar'
                    ? () =>
                        openAvatarDialog({
                            avatarId: item.id,
                            title: item.title || undefined,
                            seedData: item.seedData ?? null
                        })
                : null;
    const canRemoveLocal = item.source === 'local' && typeof onRemoveLocal === 'function';
    const canRemoveRemote = item.source === 'remote' && typeof onRemoveRemote === 'function';
    const friendActionLocation = item.kind === 'friend' ? resolvePresenceLocation(item.seedData) : '';
    const parsedFriendLocation = friendActionLocation ? parseLocation(friendActionLocation) : {};
    const canUseFriendLocation = Boolean(parsedFriendLocation.isRealInstance && parsedFriendLocation.worldId && parsedFriendLocation.instanceId);
    const isCurrentUser = Boolean(item.id && item.id === normalizeEntityId(currentUserId));
    const isFriendOnline = Boolean(item.seedData?.state === 'online' || item.seedData?.stateBucket === 'online' || item.seedData?.status === 'active');
    const canSelectAvatar = Boolean(item.kind === 'avatar' && item.id && item.id !== currentAvatarId && onAvatarSelect);
    const hasCardActions = Boolean(canRemoveLocal || canRemoveRemote || canSelectAvatar || item.kind === 'friend' || item.kind === 'world');
    const friendLocation = item.kind === 'friend' ? resolvePresenceLocation(item.seedData || item) : '';
    const friendShowsLocation = Boolean(friendLocation && friendLocation !== 'offline');
    const cardPaddingY = Math.max(4, Math.round(8 * cardScale * cardSpacing));
    const cardPaddingX = Math.max(4, Math.round(10 * cardScale * cardSpacing));
    const cardGap = Math.max(4, Math.round(8 * cardSpacing));
    const mediaSize = Math.max(28, Math.round(48 * cardScale));

    return (
        <div
            className="flex min-w-[220px] cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors hover:bg-muted"
            style={{
                gap: `${cardGap}px`,
                padding: `${cardPaddingY}px ${cardPaddingX}px`
            }}
            onClick={openHandler ?? undefined}>
            <div className={cn(
                'flex size-12 shrink-0 items-center justify-center overflow-hidden bg-muted',
                item.kind === 'friend' ? 'rounded-full' : 'rounded-sm'
            )}
            style={{
                width: `${mediaSize}px`,
                height: `${mediaSize}px`
            }}>
                {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.title} loading="lazy" className="size-full object-cover" />
                ) : (
                    item.kind === 'friend' ? <UsersIcon className="size-4 text-muted-foreground" /> : <Icon className="size-4 text-muted-foreground" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span
                        className="truncate font-medium"
                        style={item.titleColor ? { color: item.titleColor } : undefined}>
                        {item.title}
                    </span>
                    {item.isUnavailable ? <TriangleAlertIcon className="size-4 shrink-0 text-destructive" /> : null}
                    {item.isPrivate ? <LockIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
                </div>
                {friendShowsLocation ? (
                    <div className="truncate text-xs text-muted-foreground" onClick={(event) => event.stopPropagation()}>
                        <Location
                            location={friendLocation}
                            traveling={item.travelingToLocation}
                            hint={item.seedData?.worldName || item.seedData?.travelingToWorld || ''}
                            grouphint={item.seedData?.groupName || ''}
                            link={false}
                            asButton={false}
                            disableTooltip
                        />
                    </div>
                ) : (
                    <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
                )}
                {showGroupLabel ? (
                    <div className="truncate text-[11px] text-muted-foreground">
                        {item.source === 'remote' ? 'VRChat' : 'Local'} / {item.groupLabel}
                    </div>
                ) : null}
            </div>
            {editMode ? (
                <Checkbox
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) => onToggleSelect(Boolean(checked))}
                />
            ) : hasCardActions ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full"
                            disabled={removing}
                            onClick={(event) => event.stopPropagation()}>
                            {removing ? (
                                <LoaderCircleIcon className="size-4 animate-spin" />
                            ) : (
                                <MoreHorizontalIcon className="size-4" />
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                openHandler?.();
                            }}>
                            View details
                        </DropdownMenuItem>
                        {item.kind === 'friend' ? (
                            <>
                                <DropdownMenuItem
                                    disabled={isCurrentUser || !isFriendOnline || !onFriendRequestInvite}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onFriendRequestInvite?.(item);
                                    }}>
                                    Request invite
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={isCurrentUser || !canSendInvite || !onFriendInvite}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onFriendInvite?.(item);
                                    }}>
                                    Send invite
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={isCurrentUser || !canBoop || !onFriendBoop}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onFriendBoop?.(item);
                                    }}>
                                    Send boop
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    disabled={!canUseFriendLocation || !onFriendLaunch}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onFriendLaunch?.(item);
                                    }}>
                                    Launch in VRChat
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!canUseFriendLocation || !onFriendSelfInvite}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onFriendSelfInvite?.(item);
                                    }}>
                                    Self invite
                                </DropdownMenuItem>
                            </>
                        ) : null}
                        {item.kind === 'world' ? (
                            <>
                                <DropdownMenuItem
                                    disabled={!onWorldNewInstance}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onWorldNewInstance?.(item);
                                    }}>
                                    New instance
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!onWorldSelfInvite}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onWorldSelfInvite?.(item);
                                    }}>
                                    New instance and self invite
                                </DropdownMenuItem>
                            </>
                        ) : null}
                        {item.kind === 'avatar' ? (
                            <DropdownMenuItem
                                disabled={!canSelectAvatar}
                                onSelect={(event) => {
                                    event.preventDefault();
                                    onAvatarSelect?.(item);
                                }}>
                                Select avatar
                            </DropdownMenuItem>
                        ) : null}
                        {canRemoveLocal || canRemoveRemote ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        if (canRemoveLocal) {
                                            onRemoveLocal(item);
                                            return;
                                        }
                                        onRemoveRemote(item);
                                    }}>
                                    {item.source === 'local' ? 'Delete' : 'Unfavorite'}
                                </DropdownMenuItem>
                            </>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
}

function FavoritesPage({ kind, embedded = false }) {
    const favoriteLoadStatus = useFavoriteStore((state) => state.loadStatus);
    const favoriteDetail = useFavoriteStore((state) => state.detail);
    const favoritesSortOrder = useFavoriteStore((state) => state.favoritesSortOrder);
    const remoteFavoritesById = useFavoriteStore((state) => state.remoteFavoritesById);
    const favoriteFriendGroups = useFavoriteStore((state) => state.favoriteFriendGroups);
    const favoriteWorldGroups = useFavoriteStore((state) => state.favoriteWorldGroups);
    const favoriteAvatarGroups = useFavoriteStore((state) => state.favoriteAvatarGroups);
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localWorldFavorites = useFavoriteStore((state) => state.localWorldFavorites);
    const localAvatarFavorites = useFavoriteStore((state) => state.localAvatarFavorites);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);
    const localWorldFavoriteGroups = useFavoriteStore((state) => state.localWorldFavoriteGroups);
    const localAvatarFavoriteGroups = useFavoriteStore((state) => state.localAvatarFavoriteGroups);
    const localFriendFavoriteGroups = useFavoriteStore((state) => state.localFriendFavoriteGroups);
    const localWorldDetailsById = useFavoriteStore((state) => state.localWorldDetailsById);
    const localAvatarDetailsById = useFavoriteStore((state) => state.localAvatarDetailsById);
    const favoriteWorldIds = useFavoriteStore((state) => state.favoriteWorldIds);
    const favoriteAvatarIds = useFavoriteStore((state) => state.favoriteAvatarIds);
    const favoriteFriendIds = useFavoriteStore((state) => state.favoriteFriendIds);
    const removeLocalFavorite = useFavoriteStore((state) => state.removeLocalFavorite);
    const removeRemoteFavorite = useFavoriteStore((state) => state.removeRemoteFavorite);
    const createLocalFavoriteGroup = useFavoriteStore((state) => state.createLocalFavoriteGroup);
    const renameLocalFavoriteGroup = useFavoriteStore((state) => state.renameLocalFavoriteGroup);
    const deleteLocalFavoriteGroup = useFavoriteStore((state) => state.deleteLocalFavoriteGroup);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const gameState = useRuntimeStore((state) => state.gameState);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const sortFavorites = usePreferencesStore((state) => state.sortFavorites);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState('name');
    const [sortValue, setSortValue] = useState('date');
    const [selectedSource, setSelectedSource] = useState('remote');
    const [selectedGroupKey, setSelectedGroupKey] = useState('');
    const [removingFavoriteKey, setRemovingFavoriteKey] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [avatarHistoryLoading, setAvatarHistoryLoading] = useState(false);
    const [avatarHistory, setAvatarHistory] = useState([]);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [selectedKeys, setSelectedKeys] = useState([]);
    const [creatingLocalGroup, setCreatingLocalGroup] = useState(false);
    const [newLocalGroupName, setNewLocalGroupName] = useState('');
    const [remoteDetailsRefreshToken, setRemoteDetailsRefreshToken] = useState(0);
    const [splitterSizePx, setSplitterSizePx] = useState(SPLITTER_DEFAULT_SIZE_PX);
    const [splitterGroupWidth, setSplitterGroupWidth] = useState(SPLITTER_FALLBACK_WIDTH);
    const [splitterLayoutVersion, setSplitterLayoutVersion] = useState(0);
    const [cardScale, setCardScale] = useState(1);
    const [cardSpacing, setCardSpacing] = useState(1);
    const removingFavoriteKeyRef = useRef('');
    const splitterGroupRef = useRef(null);
    const splitterDraggingRef = useRef(false);
    const pendingSplitterSizePxRef = useRef(null);
    const selectedKeysSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
    const friendsMap = useMemo(() => new Map(Object.entries(friendsById || {})), [friendsById]);
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
    );
    const canSendInvite = Boolean(gameState?.isGameRunning && currentInviteLocation && canInviteFromCurrentLocation);
    const canBoop = Boolean(currentUserSnapshot?.isBoopingEnabled);

    const avatarTags = useMemo(
        () =>
            kind === 'avatar'
                ? Array.from(
                    new Set(
                        Object.values(remoteFavoritesById)
                            .filter((favorite) => favorite?.type === 'avatar')
                            .map((favorite) =>
                                typeof favorite?.tags?.[0] === 'string'
                                    ? favorite.tags[0].trim()
                                    : ''
                            )
                            .filter(Boolean)
                    )
                )
                : [],
        [kind, remoteFavoritesById]
    );

    const remoteEntityDetails = useFavoriteRemoteDetails({
        type: kind === 'avatar' ? 'avatar' : 'world',
        favoriteIds:
            kind === 'world' ? favoriteWorldIds : kind === 'avatar' ? favoriteAvatarIds : [],
        avatarTags,
        refreshToken: remoteDetailsRefreshToken,
        enabled:
            kind !== 'friend' &&
            favoriteLoadStatus === 'ready' &&
            (kind === 'world' ? favoriteWorldIds.length > 0 : favoriteAvatarIds.length > 0)
    });

    useEffect(() => {
        setSortValue(sortFavorites ? 'date' : 'name');
    }, [sortFavorites]);

    useEffect(() => {
        let active = true;
        const configKey = SPLITTER_CONFIG_KEYS[kind];
        configRepository
            .getString(configKey, '260')
            .then((value) => {
                if (!active) {
                    return;
                }
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    setSplitterSizePx(SPLITTER_DEFAULT_SIZE_PX);
                    setSplitterLayoutVersion((version) => version + 1);
                    return;
                }
                setSplitterSizePx(clampSplitterSizePx(parsed));
                setSplitterLayoutVersion((version) => version + 1);
            })
            .catch(() => {
                if (active) {
                    setSplitterSizePx(SPLITTER_DEFAULT_SIZE_PX);
                    setSplitterLayoutVersion((version) => version + 1);
                }
            });

        return () => {
            active = false;
        };
    }, [kind]);

    useEffect(() => {
        const element = splitterGroupRef.current;
        if (!element) {
            return undefined;
        }

        const updateWidth = () => {
            const width = element.getBoundingClientRect?.().width;
            if (Number.isFinite(width) && width > 0) {
                setSplitterGroupWidth(width);
            }
        };

        updateWidth();
        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(updateWidth);
            observer.observe(element);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', updateWidth);
        }

        return () => {
            observer?.disconnect();
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', updateWidth);
            }
        };
    }, []);

    useEffect(() => {
        let active = true;
        const scaleKey = CARD_SCALE_CONFIG_KEYS[kind];
        const spacingKey = CARD_SPACING_CONFIG_KEYS[kind];

        Promise.all([
            configRepository.getString(scaleKey, '1'),
            configRepository.getString(spacingKey, '1')
        ])
            .then(([nextScale, nextSpacing]) => {
                if (!active) {
                    return;
                }
                setCardScale(clampNumber(nextScale, CARD_SCALE_SLIDER.min, CARD_SCALE_SLIDER.max, 1));
                setCardSpacing(clampNumber(nextSpacing, CARD_SPACING_SLIDER.min, CARD_SPACING_SLIDER.max, 1));
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setCardScale(1);
                setCardSpacing(1);
            });

        return () => {
            active = false;
        };
    }, [kind]);

    useEffect(() => {
        setEditMode(false);
        setSelectedKeys([]);
        setSearchQuery('');
        setSearchMode('name');
        setSelectedSource('remote');
        setSelectedGroupKey('');
        setExportDialogOpen(false);
        setCreatingLocalGroup(false);
        setNewLocalGroupName('');
        if (kind !== 'avatar') {
            setAvatarHistory([]);
        }
    }, [kind]);

    useEffect(() => {
        let active = true;
        if (kind !== 'avatar' || !currentUserId) {
            setAvatarHistory([]);
            return () => {
                active = false;
            };
        }

        setAvatarHistoryLoading(true);
        database
            .getAvatarHistory(currentUserId, 100)
            .then((rows) => {
                if (active) {
                    setAvatarHistory(Array.isArray(rows) ? rows : []);
                }
            })
            .catch(() => {
                if (active) {
                    setAvatarHistory([]);
                }
            })
            .finally(() => {
                if (active) {
                    setAvatarHistoryLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId, kind]);

    useEffect(() => {
        if (kind !== 'world' && sortValue === 'players') {
            setSortValue('date');
        }
    }, [kind, sortValue]);

    const refreshFavorites = async () => {
        if (!currentUserId || !currentUserSnapshot || refreshing) {
            return;
        }

        setRefreshing(true);
        try {
            clearFavoriteRemoteDetailsCache();
            setRemoteDetailsRefreshToken((value) => value + 1);
            await bootstrapFavorites({
                userId: currentUserId,
                endpoint: currentEndpoint,
                currentUserSnapshot
            });
            if (kind === 'avatar') {
                const rows = await database.getAvatarHistory(currentUserId, 100);
                setAvatarHistory(Array.isArray(rows) ? rows : []);
            }
            toast.success('Favorites refreshed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to refresh favorites.');
        } finally {
            setRefreshing(false);
        }
    };

    const handleSortValueChange = (value) => {
        setSortValue(value);
        if (value === 'date' || value === 'name') {
            const nextSortByDate = value === 'date';
            void setBoolConfigPreference('sortFavorites', nextSortByDate)
                .catch((error) => {
                    toast.error(error instanceof Error ? error.message : 'Failed to save favorite sort preference.');
                });
        }
    };

    const handleCardScaleChange = (value) => {
        const nextValue = clampNumber(value, CARD_SCALE_SLIDER.min, CARD_SCALE_SLIDER.max, 1);
        setCardScale(nextValue);
        void configRepository.setString(CARD_SCALE_CONFIG_KEYS[kind], String(nextValue));
    };

    const handleCardSpacingChange = (value) => {
        const nextValue = clampNumber(value, CARD_SPACING_SLIDER.min, CARD_SPACING_SLIDER.max, 1);
        setCardSpacing(nextValue);
        void configRepository.setString(CARD_SPACING_CONFIG_KEYS[kind], String(nextValue));
    };

    const handleRemoveLocalFavorite = async (item, { silent = false } = {}) => {
        if (!item || item.source !== 'local' || (!silent && removingFavoriteKeyRef.current)) {
            return false;
        }

        if (!silent) {
            removingFavoriteKeyRef.current = item.key;
            setRemovingFavoriteKey(item.key);
            const result = await confirm({
                title: 'Remove local favorite?',
                description: `Remove ${item.title || 'favorite'} from ${item.groupLabel || 'Favorites'}?`,
                destructive: true,
                confirmText: 'Remove',
                cancelText: 'Cancel'
            });

            if (!result.ok) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey('');
                return false;
            }
        }

        try {
            await localFavoritesRepository.removeLocalFavorite({
                kind: item.kind,
                entityId: item.id,
                groupName: item.groupKey
            });
            removeLocalFavorite({
                kind: item.kind,
                entityId: item.id,
                groupName: item.groupKey
            });
            if (!silent) {
                toast.success('Local favorite removed.');
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to remove local favorite.');
            return false;
        } finally {
            if (!silent) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey((currentKey) =>
                    currentKey === item.key ? '' : currentKey
                );
            }
        }
    };

    const handleRemoveRemoteFavorite = async (item, { silent = false } = {}) => {
        if (!item || item.source !== 'remote' || (!silent && removingFavoriteKeyRef.current)) {
            return false;
        }

        if (!silent) {
            removingFavoriteKeyRef.current = item.key;
            setRemovingFavoriteKey(item.key);
            const result = await confirm({
                title: 'Remove VRChat favorite?',
                description: `Remove ${item.title || 'favorite'} from ${item.groupLabel || 'Favorites'}?`,
                destructive: true,
                confirmText: 'Remove',
                cancelText: 'Cancel'
            });

            if (!result.ok) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey('');
                return false;
            }
        }

        try {
            await vrchatFavoriteRepository.deleteFavorite({
                endpoint: currentEndpoint,
                objectId: item.id
            });
            removeRemoteFavorite(item.id);
            if (!silent) {
                toast.success('VRChat favorite removed.');
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to remove VRChat favorite.');
            return false;
        } finally {
            if (!silent) {
                removingFavoriteKeyRef.current = '';
                setRemovingFavoriteKey((currentKey) =>
                    currentKey === item.key ? '' : currentKey
                );
            }
        }
    };

    const favoritesSortIndex = useMemo(() => {
        const index = Object.create(null);
        favoritesSortOrder.forEach((favoriteId, position) => {
            index[favoriteId] = position;
        });
        return index;
    }, [favoritesSortOrder]);

    const pageConfig = useMemo(() => {
        if (kind === 'friend') {
            return {
                title: 'Favorite Friends',
                description:
                    'Favorite groups for VRChat and local friend favorites.',
                icon: UserIcon,
                remoteSectionTitle: 'VRChat Favorites',
                localSectionTitle: 'Local Favorites',
                searchPlaceholder: 'Search favorite friends',
                remoteCount: favoriteFriendIds.length,
                localCount: Object.values(localFriendFavorites).flat().length
            };
        }

        if (kind === 'avatar') {
            return {
                title: 'Favorite Avatars',
                description:
                    'Remote avatar favorites with local cache fallback.',
                icon: ImageIcon,
                remoteSectionTitle: 'VRChat Favorites',
                localSectionTitle: 'Local Favorites',
                searchPlaceholder: 'Search favorite avatars',
                remoteCount: favoriteAvatarIds.length,
                localCount: Object.values(localAvatarFavorites).flat().length
            };
        }

        return {
            title: 'Favorite Worlds',
            description:
                'Remote world favorites with local cache fallback.',
            icon: GlobeIcon,
            remoteSectionTitle: 'VRChat Favorites',
            localSectionTitle: 'Local Favorites',
            searchPlaceholder: 'Search favorite worlds',
            remoteCount: favoriteWorldIds.length,
            localCount: Object.values(localWorldFavorites).flat().length
        };
    }, [
        favoriteAvatarIds.length,
        favoriteFriendIds.length,
        favoriteWorldIds.length,
        kind,
        localAvatarFavorites,
        localFriendFavorites,
        localWorldFavorites
    ]);

    const remoteGroups = useMemo(() => {
        const sourceGroups =
            kind === 'friend'
                ? favoriteFriendGroups
                : kind === 'avatar'
                    ? favoriteAvatarGroups
                    : favoriteWorldGroups;

        return sourceGroups.map((group) => ({
            source: 'remote',
            key: group.key,
            name: group.name || String(group.key || '').split(':').pop() || '',
            type: group.type || favoriteGroupType(kind, group),
            label: group.displayName || group.name || group.key,
            count: Number(group.count) || 0,
            capacity: Number(group.capacity) || 0,
            visibility: group.visibility || ''
        }));
    }, [favoriteAvatarGroups, favoriteFriendGroups, favoriteWorldGroups, kind]);

    const localGroups = useMemo(() => {
        const names =
            kind === 'friend'
                ? localFriendFavoriteGroups
                : kind === 'avatar'
                    ? localAvatarFavoriteGroups
                    : localWorldFavoriteGroups;
        const source =
            kind === 'friend'
                ? localFriendFavorites
                : kind === 'avatar'
                    ? localAvatarFavorites
                    : localWorldFavorites;

        return names.map((name) => ({
            source: 'local',
            key: name,
            label: name,
            count: Array.isArray(source[name]) ? source[name].length : 0,
            capacity: 0,
            visibility: ''
        }));
    }, [
        kind,
        localAvatarFavoriteGroups,
        localAvatarFavorites,
        localFriendFavoriteGroups,
        localFriendFavorites,
        localWorldFavoriteGroups,
        localWorldFavorites
    ]);

    const avatarHistoryGroups = useMemo(() => {
        if (kind !== 'avatar') {
            return [];
        }
        return [{
            source: 'history',
            key: 'local-history',
            label: 'Local History',
            count: avatarHistory.length,
            capacity: 100,
            visibility: ''
        }];
    }, [avatarHistory.length, kind]);

    const remoteGroupLabelByKey = useMemo(
        () =>
            Object.fromEntries(remoteGroups.map((group) => [group.key, group.label])),
        [remoteGroups]
    );

    const remoteItemsByGroup = useMemo(() => {
        const itemsByGroup = Object.create(null);
        for (const group of remoteGroups) {
            itemsByGroup[group.key] = [];
        }

        if (kind === 'friend') {
            for (const group of remoteGroups) {
                const ids = groupedFavoriteFriendIdsByGroupKey[group.key] || [];
                const items = ids.map((friendId, index) => {
                    const normalizedId = normalizeEntityId(friendId);
                    const friend = friendsById[normalizedId];
                    const status = friend?.stateBucket || friend?.state || 'offline';
                    const location = resolvePresenceLocation(friend);
                    const subtitle = friend ? (location && location !== 'offline' ? location : friend?.statusDescription || '') : '';

                    return {
                        key: `remote:${group.key}:${normalizedId}`,
                        kind,
                        source: 'remote',
                        groupKey: group.key,
                        groupLabel: group.label,
                        id: normalizedId,
                        title: friend?.displayName || friend?.username || 'User',
                        titleColor: friend?.$userColour || '',
                        subtitle,
                        detailText: '',
                        location,
                        travelingToLocation: friend?.travelingToLocation || '',
                        imageUrl: friend ? userImage(friend, true) : '',
                        statusLabel: status,
                        statusVariant:
                            status === 'online' || status === 'active'
                                ? 'default'
                                : 'secondary',
                        seedData: friend || null,
                        orderIndex: favoritesSortIndex[normalizedId] ?? index
                    };
                });
                itemsByGroup[group.key] = sortItems(items, sortValue);
            }

            return itemsByGroup;
        }

        const remoteFavorites = Object.values(remoteFavoritesById).filter((favorite) => {
            if (kind === 'avatar') {
                return favorite?.type === 'avatar';
            }
            return favorite?.type === 'world' || favorite?.type === 'vrcPlusWorld';
        });

        for (const favorite of remoteFavorites) {
            const favoriteId = normalizeEntityId(favorite.favoriteId);
            const groupKey = favorite.$groupKey;
            if (!favoriteId || !groupKey || !itemsByGroup[groupKey]) {
                continue;
            }

            const detail = remoteEntityDetails.data[favoriteId];
            const isUnavailable = remoteEntityDetails.status === 'ready' && !detail;
            const playerCount = Number(detail?.occupants) || 0;
            const subtitle =
                kind === 'world'
                    ? detail?.authorName
                        ? playerCount
                            ? `${detail.authorName} (${playerCount})`
                            : detail.authorName
                        : isUnavailable
                            ? 'World details are unavailable.'
                            : 'Loading world details.'
                    : detail?.authorName ||
                        (isUnavailable
                            ? 'Avatar details are unavailable.'
                            : 'Loading avatar details.');

            itemsByGroup[groupKey].push({
                key: `remote:${groupKey}:${favoriteId}`,
                kind,
                source: 'remote',
                groupKey,
                groupLabel: remoteGroupLabelByKey[groupKey] || 'Favorites',
                id: favoriteId,
                title: detail?.name || (kind === 'world' ? 'World' : 'Avatar'),
                subtitle,
                description: detail?.description || '',
                seedData: detail || null,
                imageUrl: shrinkImage(
                    detail?.thumbnailImageUrl || detail?.imageUrl || ''
                ),
                isPrivate: detail?.releaseStatus === 'private',
                isUnavailable,
                tags: detail?.tags || [],
                playerCount,
                orderIndex: favoritesSortIndex[favoriteId] ?? Number.MAX_SAFE_INTEGER
            });
        }

        for (const group of remoteGroups) {
            itemsByGroup[group.key] = sortItems(itemsByGroup[group.key] || [], sortValue);
        }

        return itemsByGroup;
    }, [
        favoritesSortIndex,
        friendsById,
        groupedFavoriteFriendIdsByGroupKey,
        kind,
        remoteEntityDetails.data,
        remoteEntityDetails.status,
        remoteFavoritesById,
        remoteGroupLabelByKey,
        remoteGroups,
        sortValue
    ]);

    const localItemsByGroup = useMemo(() => {
        const itemsByGroup = Object.create(null);

        if (kind === 'friend') {
            for (const group of localGroups) {
                const ids = Array.isArray(localFriendFavorites[group.key])
                    ? localFriendFavorites[group.key]
                    : [];
                const items = ids.map((friendId, index) => {
                    const normalizedId = normalizeEntityId(friendId);
                    const friend = friendsById[normalizedId];
                    const status = friend?.stateBucket || friend?.state || 'offline';
                    const location = resolvePresenceLocation(friend);
                    return {
                        key: `local:${group.key}:${normalizedId}`,
                        kind,
                        source: 'local',
                        groupKey: group.key,
                        groupLabel: group.label,
                        id: normalizedId,
                        title: friend?.displayName || friend?.username || 'User',
                        titleColor: friend?.$userColour || '',
                        subtitle: friend ? (location && location !== 'offline' ? location : friend?.statusDescription || '') : '',
                        detailText: '',
                        location,
                        travelingToLocation: friend?.travelingToLocation || '',
                        imageUrl: friend ? userImage(friend, true) : '',
                        statusLabel: status,
                        statusVariant:
                            status === 'online' || status === 'active'
                                ? 'default'
                                : 'secondary',
                        seedData: friend || null,
                        orderIndex: index
                    };
                });
                itemsByGroup[group.key] = sortItems(items, sortValue);
            }

            return itemsByGroup;
        }

        const localFavorites = kind === 'avatar' ? localAvatarFavorites : localWorldFavorites;
        const localDetailsById =
            kind === 'avatar' ? localAvatarDetailsById : localWorldDetailsById;

        for (const group of localGroups) {
            const ids = Array.isArray(localFavorites[group.key])
                ? localFavorites[group.key]
                : [];
            const items = ids.map((entityId, index) => {
                const normalizedId = normalizeEntityId(entityId);
                const detail = localDetailsById[normalizedId] || { id: normalizedId };
                const playerCount = Number(detail.occupants) || 0;
                return {
                    key: `local:${group.key}:${normalizedId}`,
                    kind,
                    source: 'local',
                    groupKey: group.key,
                    groupLabel: group.label,
                    id: normalizedId,
                    title: detail.name || (kind === 'world' ? 'World' : 'Avatar'),
                    subtitle:
                        kind === 'world'
                            ? detail.authorName || ''
                            : detail.authorName || '',
                    description: detail.description || '',
                    seedData: detail || null,
                    imageUrl: shrinkImage(
                        detail.thumbnailImageUrl || detail.imageUrl || ''
                    ),
                    isPrivate: detail.releaseStatus === 'private',
                    isUnavailable: false,
                    tags: detail.tags || [],
                    playerCount,
                    orderIndex: index
                };
            });
            itemsByGroup[group.key] = sortItems(items, sortValue);
        }

        return itemsByGroup;
    }, [
        friendsById,
        kind,
        localAvatarDetailsById,
        localAvatarFavorites,
        localFriendFavorites,
        localGroups,
        localWorldDetailsById,
        localWorldFavorites,
        sortValue
    ]);

    const avatarHistoryItems = useMemo(() => {
        if (kind !== 'avatar') {
            return EMPTY_ITEMS;
        }

        return avatarHistory.map((detail, index) => {
            const normalizedId = normalizeEntityId(detail?.id);
            return {
                key: `history:local-history:${normalizedId || index}`,
                kind: 'avatar',
                source: 'history',
                groupKey: 'local-history',
                groupLabel: 'Local History',
                id: normalizedId,
                title: detail?.name || 'Avatar',
                subtitle: detail?.authorName || '',
                description: detail?.description || '',
                seedData: detail || null,
                imageUrl: shrinkImage(detail?.thumbnailImageUrl || detail?.imageUrl || ''),
                isPrivate: detail?.releaseStatus === 'private',
                isUnavailable: false,
                tags: detail?.tags || [],
                playerCount: 0,
                orderIndex: index
            };
        });
    }, [avatarHistory, kind]);

    const allItems = useMemo(
        () => [...Object.values(remoteItemsByGroup).flat(), ...Object.values(localItemsByGroup).flat()],
        [localItemsByGroup, remoteItemsByGroup]
    );

    const searchNeedle = normalizeSearchValue(searchQuery);
    const isSearchActive = searchNeedle.length >= 3;
    const hasSearchInput = searchNeedle.length > 0;
    const filteredItems = useMemo(() => {
        if (!isSearchActive) {
            return [];
        }

        return allItems.filter((item) => {
            if (kind === 'world' && searchMode === 'tag') {
                const matchesTag = Array.isArray(item.tags) &&
                    item.tags.some((tag) =>
                        typeof tag === 'string' &&
                        tag.startsWith('author_tag_') &&
                        tag.substring(11).toLowerCase().includes(searchNeedle)
                    );
                if (!matchesTag) {
                    return false;
                }
            } else {
                const matchesText = [item.title, item.subtitle, item.description, item.id, item.groupLabel, item.statusLabel]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(searchNeedle);
                if (!matchesText) {
                    return false;
                }
            }

            return true;
        });
    }, [allItems, isSearchActive, kind, searchMode, searchNeedle]);

    useEffect(() => {
        const hasSelection =
            (selectedSource === 'remote'
                ? remoteGroups
                : selectedSource === 'history'
                    ? avatarHistoryGroups
                    : localGroups
            ).some(
                (group) => group.key === selectedGroupKey
            );
        if (hasSelection) {
            return;
        }

        const nextGroup =
            remoteGroups.find((group) => group.count > 0) ||
            localGroups.find((group) => group.count > 0) ||
            avatarHistoryGroups.find((group) => group.count > 0) ||
            remoteGroups[0] ||
            localGroups[0] ||
            avatarHistoryGroups[0] ||
            null;
        if (!nextGroup) {
            setSelectedGroupKey('');
            return;
        }

        setSelectedSource(nextGroup.source);
        setSelectedGroupKey(nextGroup.key);
    }, [avatarHistoryGroups, localGroups, remoteGroups, selectedGroupKey, selectedSource]);

    const selectedGroup = useMemo(
        () =>
            (selectedSource === 'remote'
                ? remoteGroups
                : selectedSource === 'history'
                    ? avatarHistoryGroups
                    : localGroups
            ).find(
                (group) => group.key === selectedGroupKey
            ) || null,
        [avatarHistoryGroups, localGroups, remoteGroups, selectedGroupKey, selectedSource]
    );
    const selectedItems = useMemo(() => {
        if (!selectedGroup) {
            return EMPTY_ITEMS;
        }
        if (selectedSource === 'history') {
            return avatarHistoryItems;
        }
        return (
            selectedSource === 'remote'
                ? remoteItemsByGroup[selectedGroup.key]
                : localItemsByGroup[selectedGroup.key]
        ) || EMPTY_ITEMS;
    }, [avatarHistoryItems, localItemsByGroup, remoteItemsByGroup, selectedGroup, selectedSource]);
    const contentItems = useMemo(
        () => (isSearchActive ? filteredItems : selectedItems),
        [filteredItems, isSearchActive, selectedItems]
    );
    const isAllSelected = contentItems.length > 0 && contentItems.every((item) => selectedKeysSet.has(item.key));
    const hasSelection = selectedKeys.length > 0;
    const avatarEditSelectionDisabled = kind === 'avatar' && selectedSource !== 'remote';
    const editModeDisabled = isSearchActive || !selectedGroup || contentItems.length === 0 || avatarEditSelectionDisabled;
    const showCopyButton = selectedSource !== 'local';
    const selectedContentItems = contentItems.filter((item) => selectedKeysSet.has(item.key));
    const canCreateLocalGroup =
        kind !== 'avatar' ||
        Boolean(currentUserSnapshot?.$isVRCPlus || currentUserSnapshot?.tags?.includes?.('system_supporter'));

    useEffect(() => {
        if (isSearchActive && editMode) {
            setEditMode(false);
            setSelectedKeys([]);
        }
    }, [editMode, isSearchActive]);

    useEffect(() => {
        setSelectedKeys((keys) => {
            const nextKeys = keys.filter((key) => contentItems.some((item) => item.key === key));
            return nextKeys.length === keys.length ? keys : nextKeys;
        });
    }, [contentItems]);

    async function exportCurrentFavorites() {
        if (!allItems.length) {
            toast.error('No favorites available to export.');
            return;
        }

        setExportDialogOpen(true);
    }

    async function handleRemoteGroupRename(group) {
        const result = await prompt({
            title: 'Change favorite group name',
            description: 'Enter the new display name.',
            inputValue: group.label || group.name,
            pattern: /\S+/,
            confirmText: 'Change',
            cancelText: 'Cancel',
            errorMessage: 'Group name is required.'
        });
        if (!result.ok) {
            return;
        }
        const nextName = result.value.trim();
        if (!nextName || nextName === group.label) {
            return;
        }

        try {
            await vrchatFavoriteRepository.saveFavoriteGroup({
                endpoint: currentEndpoint,
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name,
                displayName: nextName
            });
            await refreshFavorites();
            toast.success('Favorite group renamed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to rename favorite group.');
        }
    }

    async function handleRemoteGroupVisibility(group, visibility) {
        if (group.visibility === visibility) {
            return;
        }

        try {
            await vrchatFavoriteRepository.saveFavoriteGroup({
                endpoint: currentEndpoint,
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name,
                visibility
            });
            await refreshFavorites();
            toast.success('Group visibility changed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to change group visibility.');
        }
    }

    async function handleRemoteGroupClear(group) {
        const result = await confirm({
            title: 'Clear favorite group?',
            description: 'Remove all favorites from this group?',
            destructive: true,
            confirmText: 'Clear',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        try {
            await vrchatFavoriteRepository.clearFavoriteGroup({
                endpoint: currentEndpoint,
                ownerId: currentUserId,
                type: favoriteGroupType(kind, group),
                group: group.name
            });
            await refreshFavorites();
            toast.success('Favorite group cleared.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to clear favorite group.');
        }
    }

    async function handleLocalGroupRename(group) {
        const result = await prompt({
            title: 'Rename local favorite group',
            description: 'Enter the new local group name.',
            inputValue: group.label,
            pattern: /\S+/,
            confirmText: 'Save',
            cancelText: 'Cancel',
            errorMessage: 'Group name is required.'
        });
        if (!result.ok) {
            return;
        }
        const nextName = result.value.trim();
        if (!nextName || nextName === group.key) {
            return;
        }
        if (localGroups.some((localGroup) => localGroup.key === nextName)) {
            toast.error(`Local group ${nextName} already exists.`);
            return;
        }

        try {
            await localFavoritesRepository.renameLocalFavoriteGroup({
                kind,
                groupName: group.key,
                newGroupName: nextName
            });
            renameLocalFavoriteGroup({ kind, groupName: group.key, newGroupName: nextName });
            if (selectedSource === 'local' && selectedGroupKey === group.key) {
                setSelectedGroupKey(nextName);
            }
            toast.success('Local favorite group renamed.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to rename local favorite group.');
        }
    }

    async function handleLocalGroupDelete(group) {
        const result = await confirm({
            title: 'Delete local favorite group?',
            description: `Delete ${group.label}?`,
            destructive: true,
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        try {
            await localFavoritesRepository.deleteLocalFavoriteGroup({ kind, groupName: group.key });
            deleteLocalFavoriteGroup({ kind, groupName: group.key });
            if (selectedSource === 'local' && selectedGroupKey === group.key) {
                setSelectedGroupKey('');
            }
            toast.success('Local favorite group deleted.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete local favorite group.');
        }
    }

    async function refreshAvatarHistory() {
        if (kind !== 'avatar' || !currentUserId || avatarHistoryLoading) {
            return;
        }

        setAvatarHistoryLoading(true);
        try {
            const rows = await database.getAvatarHistory(currentUserId, 100);
            setAvatarHistory(Array.isArray(rows) ? rows : []);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to refresh avatar history.');
        } finally {
            setAvatarHistoryLoading(false);
        }
    }

    async function handleAvatarHistoryClear() {
        const result = await confirm({
            title: 'Clear avatar history?',
            description: 'Clear local avatar history and cached avatar metadata?',
            destructive: true,
            confirmText: 'Clear',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        try {
            await database.clearAvatarHistory();
            setAvatarHistory([]);
            if (selectedSource === 'history') {
                setSelectedGroupKey('');
            }
            toast.success('Avatar history cleared.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to clear avatar history.');
        }
    }

    function getFavoriteFriend(item) {
        const userId = normalizeEntityId(item?.id);
        return item?.seedData || friendsById[userId] || {
            id: userId,
            displayName: item?.title || userId,
            location: ''
        };
    }

    async function launchFavoriteFriendLocation(item) {
        const friend = getFavoriteFriend(item);
        const location = resolvePresenceLocation(friend);
        const parsedLocation = parseLocation(location);
        if (!parsedLocation.isRealInstance || !parsedLocation.worldId || !parsedLocation.instanceId) {
            return;
        }

        try {
            const opened = await tryOpenLaunchLocation(location, parsedLocation.shortName || '', currentEndpoint);
            if (opened) {
                toast.success('VRChat launch request sent.');
                return;
            }
            toast.error('Unable to open this instance in VRChat.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to launch instance.');
        }
    }

    async function selfInviteFavoriteFriendLocation(item) {
        const friend = getFavoriteFriend(item);
        const location = resolvePresenceLocation(friend);
        const parsedLocation = parseLocation(location);
        if (!parsedLocation.isRealInstance || !parsedLocation.worldId || !parsedLocation.instanceId) {
            return;
        }
        if (!checkCanInviteSelf(location, { currentUserId, cachedInstances: new Map(), friends: friendsMap })) {
            toast.error('Cannot self invite to this instance.');
            return;
        }

        try {
            await selfInviteToInstance(location, parsedLocation.shortName || '', currentEndpoint);
            toast.success('Self invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send self invite.');
        }
    }

    async function sendFavoriteFriendInvite(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error('Cannot invite: no current VRChat location is available.');
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error('Cannot invite from the current instance type.');
            return;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error('Cannot invite: current location is not a concrete instance.');
            return;
        }

        const result = await confirm({
            title: 'Send invite?',
            description: friend?.displayName || 'this user',
            confirmText: 'Invite',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                parsedLocation.worldId,
                { endpoint: currentEndpoint }
            );
            const inviteLocation = parsedLocation.tag || currentInviteLocation;
            await notificationRepository.sendInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    instanceId: inviteLocation,
                    worldId: parsedLocation.worldId,
                    worldName: worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            toast.success('Invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send invite.');
        }
    }

    async function requestFavoriteFriendInvite(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }

        const result = await confirm({
            title: 'Request invite?',
            description: friend?.displayName || 'this user',
            confirmText: 'Request Invite',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        try {
            await notificationRepository.sendRequestInvite({
                receiverUserId: friendId,
                endpoint: currentEndpoint,
                params: {
                    platform: 'standalonewindows'
                }
            });
            toast.success('Invite request sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to request invite.');
        }
    }

    async function sendFavoriteFriendBoop(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }

        try {
            const result = await prompt({
                title: 'Send boop',
                description: 'Optional emoji id. Leave blank to send the default boop.',
                inputValue: '',
                confirmText: 'Send',
                cancelText: 'Cancel'
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success('Boop sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send boop.');
        }
    }

    function openWorldNewInstance(item, selfInvite = false) {
        if (!item?.id) {
            return;
        }

        openWorldDialog({
            worldId: item.id,
            title: item.title || undefined,
            seedData: item.seedData ?? null,
            initialAction: selfInvite ? 'newInstanceSelfInvite' : 'newInstance'
        });
    }

    async function selectFavoriteAvatar(item) {
        if (!item?.id) {
            return;
        }
        const shouldConfirm = await configRepository.getBool('showConfirmationOnSwitchAvatar', true);
        if (shouldConfirm) {
            const result = await confirm({
                title: 'Select avatar?',
                description: item.title || 'Avatar',
                confirmText: 'Select',
                cancelText: 'Cancel'
            });
            if (!result.ok) {
                return;
            }
        }

        try {
            await avatarProfileRepository.selectAvatar({
                avatarId: item.id,
                endpoint: currentEndpoint
            });
            toast.success('Avatar selected.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to select avatar.');
        }
    }

    async function confirmCreateLocalGroup() {
        if (refreshing) {
            return;
        }

        const nextName = newLocalGroupName.trim();
        if (!nextName) {
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
            return;
        }
        if (localGroups.some((group) => group.key === nextName)) {
            toast.error(`Local group ${nextName} already exists.`);
            return;
        }
        try {
            await localFavoritesRepository.createLocalFavoriteGroup({ kind, groupName: nextName });
            createLocalFavoriteGroup({ kind, groupName: nextName });
            setSelectedSource('local');
            setSelectedGroupKey(nextName);
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to create local favorite group.');
        }
    }

    function toggleSelectAll() {
        if (isAllSelected) {
            setSelectedKeys([]);
            return;
        }
        setSelectedKeys(contentItems.map((item) => item.key));
    }

    async function copySelection() {
        if (!selectedContentItems.length) {
            return;
        }

        try {
            await navigator.clipboard.writeText(selectedContentItems.map((item) => `${item.id}\n`).join(''));
            toast.success('Copied selected favorite ids.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to copy selected favorites.');
        }
    }

    async function bulkRemoveSelection() {
        if (!selectedContentItems.length) {
            return;
        }

        const result = await confirm({
            title: `Delete ${selectedContentItems.length} favorites?`,
            description: 'This action cannot be undone.',
            destructive: true,
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        let removedCount = 0;
        let failedCount = 0;
        const removedKeys = new Set();
        for (const item of selectedContentItems) {
            try {
                const removed = item.source === 'local'
                    ? await handleRemoveLocalFavorite(item, { silent: true })
                    : await handleRemoveRemoteFavorite(item, { silent: true });
                if (removed) {
                    removedCount += 1;
                    removedKeys.add(item.key);
                } else {
                    failedCount += 1;
                }
            } catch {
                failedCount += 1;
            }
        }
        if (removedCount > 0) {
            setSelectedKeys((current) =>
                current.filter((key) => !removedKeys.has(key))
            );
        }
        if (failedCount === 0) {
            setEditMode(false);
            toast.success('Selected favorites removed.');
            return;
        }
        toast.error(`Removed ${removedCount}; ${failedCount} failed.`);
    }

    const splitterDefaultSize = pxToSplitterPercent(splitterSizePx, splitterGroupWidth);
    const splitterMinSize = pxToSplitterPercent(SPLITTER_MIN_SIZE_PX, splitterGroupWidth);
    const splitterMaxSize = pxToSplitterPercent(SPLITTER_MAX_SIZE_PX, splitterGroupWidth);

    function persistSplitterSizePx(nextSizePx) {
        const clampedSizePx = clampSplitterSizePx(nextSizePx);
        setSplitterSizePx(clampedSizePx);
        void configRepository.setString(SPLITTER_CONFIG_KEYS[kind], String(clampedSizePx));
    }

    function persistSplitterLayout(sizes) {
        const nextSize = Array.isArray(sizes) ? Number(sizes[0]) : NaN;
        if (!Number.isFinite(nextSize) || nextSize < 0) {
            return;
        }
        if (!splitterDraggingRef.current) {
            return;
        }
        pendingSplitterSizePxRef.current = splitterPercentToPx(nextSize, splitterGroupWidth);
    }

    function handleSplitterDragging(isDragging) {
        splitterDraggingRef.current = Boolean(isDragging);
        if (isDragging) {
            return;
        }
        const pendingSizePx = pendingSplitterSizePxRef.current;
        pendingSplitterSizePxRef.current = null;
        if (Number.isFinite(pendingSizePx)) {
            persistSplitterSizePx(pendingSizePx);
        }
    }

    const title = isSearchActive
        ? 'Search'
        : selectedGroup
            ? selectedGroup.label
            : 'No Group Selected';
    const subtitle = isSearchActive
        ? `${contentItems.length} result${contentItems.length === 1 ? '' : 's'}`
        : selectedGroup
            ? selectedGroup.capacity
                ? `${selectedGroup.count}/${selectedGroup.capacity}`
                : String(selectedGroup.count)
            : '';

    return (
        <div
            className={
                embedded
                    ? 'flex h-full min-h-0 flex-1 flex-col p-4 pb-0'
                    : 'x-container flex h-full min-h-0 flex-1 flex-col pb-0'
            }>
            <FavoritesToolbar
                kind={kind}
                sortValue={sortValue}
                searchQuery={searchQuery}
                searchPlaceholder={pageConfig.searchPlaceholder}
                searchMode={searchMode}
                cardScale={cardScale}
                cardSpacing={cardSpacing}
                refreshing={refreshing || favoriteLoadStatus === 'running'}
                onSortValueChange={handleSortValueChange}
                onSearchChange={setSearchQuery}
                onSearchModeChange={setSearchMode}
                onCardScaleChange={handleCardScaleChange}
                onCardSpacingChange={handleCardSpacingChange}
                onRefresh={() => void refreshFavorites()}
                onImport={() => openFavoriteImportDialog({ type: kind })}
                onExport={() => void exportCurrentFavorites()}
            />
            <FavoriteExportDialog
                open={exportDialogOpen}
                onOpenChange={setExportDialogOpen}
                kind={kind}
                remoteGroups={remoteGroups}
                localGroups={localGroups}
                remoteItemsByGroup={remoteItemsByGroup}
                localItemsByGroup={localItemsByGroup}
            />

            <div ref={splitterGroupRef} className="flex h-full min-h-0 flex-1">
                <ResizablePanelGroup
                    key={`${kind}:${splitterLayoutVersion}:${Math.round(splitterGroupWidth)}`}
                    direction="horizontal"
                    className="h-full min-h-0 flex-1"
                    onLayout={persistSplitterLayout}>
                    <ResizablePanel defaultSize={splitterDefaultSize} minSize={splitterMinSize} maxSize={splitterMaxSize} collapsible collapsedSize={0} order={1}>
                        <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto pr-2">
                            <GroupRailSection
                                title={pageConfig.remoteSectionTitle}
                                groups={remoteGroups}
                                selectedSource={hasSearchInput ? '' : selectedSource}
                                selectedGroupKey={hasSearchInput ? '' : selectedGroupKey}
                                loading={favoriteLoadStatus === 'running' || refreshing}
                                onRefresh={() => void refreshFavorites()}
                                onSelect={(group) => {
                                    setSearchQuery('');
                                    setSelectedSource(group.source);
                                    setSelectedGroupKey(group.key);
                                }}
                                onRemoteRename={handleRemoteGroupRename}
                                onRemoteVisibility={handleRemoteGroupVisibility}
                                onRemoteClear={handleRemoteGroupClear}
                                onLocalRename={handleLocalGroupRename}
                                onLocalDelete={handleLocalGroupDelete}
                            />
                            <GroupRailSection
                                title={pageConfig.localSectionTitle}
                                groups={localGroups}
                                selectedSource={hasSearchInput ? '' : selectedSource}
                                selectedGroupKey={hasSearchInput ? '' : selectedGroupKey}
                                loading={refreshing}
                                creating={creatingLocalGroup}
                                newGroupName={newLocalGroupName}
                                showNewGroup={canCreateLocalGroup}
                                onRefresh={() => void refreshFavorites()}
                                onSelect={(group) => {
                                    setSearchQuery('');
                                    setSelectedSource(group.source);
                                    setSelectedGroupKey(group.key);
                                }}
                                onStartCreate={() => {
                                    setCreatingLocalGroup(true);
                                    setNewLocalGroupName('');
                                }}
                                onNewGroupNameChange={setNewLocalGroupName}
                                onConfirmCreate={confirmCreateLocalGroup}
                                onCancelCreate={() => {
                                    setCreatingLocalGroup(false);
                                    setNewLocalGroupName('');
                                }}
                                onRemoteRename={handleRemoteGroupRename}
                                onRemoteVisibility={handleRemoteGroupVisibility}
                                onRemoteClear={handleRemoteGroupClear}
                                onLocalRename={handleLocalGroupRename}
                                onLocalDelete={handleLocalGroupDelete}
                            />
                            {kind === 'avatar' ? (
                                <GroupRailSection
                                    title="Local History"
                                    groups={avatarHistoryGroups}
                                    selectedSource={hasSearchInput ? '' : selectedSource}
                                    selectedGroupKey={hasSearchInput ? '' : selectedGroupKey}
                                    loading={avatarHistoryLoading}
                                    onRefresh={() => void refreshAvatarHistory()}
                                    onSelect={(group) => {
                                        setSearchQuery('');
                                        setSelectedSource(group.source);
                                        setSelectedGroupKey(group.key);
                                    }}
                                    onRemoteRename={handleRemoteGroupRename}
                                    onRemoteVisibility={handleRemoteGroupVisibility}
                                    onRemoteClear={handleRemoteGroupClear}
                                    onLocalRename={handleLocalGroupRename}
                                    onLocalDelete={handleLocalGroupDelete}
                                    onHistoryClear={() => void handleAvatarHistoryClear()}
                                />
                            ) : null}
                        </div>
                    </ResizablePanel>
                    <ResizableHandle withHandle onDragging={handleSplitterDragging} />
                    <ResizablePanel order={2}>
                    <div className="flex h-full min-h-0 flex-col pl-[26px]">
                        <FavoritesContentHeader
                            title={title}
                            subtitle={subtitle}
                            editMode={editMode}
                            editModeDisabled={editModeDisabled}
                            editModeVisible={editMode && !isSearchActive && !avatarEditSelectionDisabled}
                            isAllSelected={isAllSelected}
                            hasSelection={hasSelection}
                            showCopyButton={showCopyButton}
                            onEditModeChange={(value) => {
                                setEditMode(value);
                                if (!value) {
                                    setSelectedKeys([]);
                                }
                            }}
                            onToggleSelectAll={toggleSelectAll}
                            onClearSelection={() => setSelectedKeys([])}
                            onCopySelection={() => void copySelection()}
                            onBulkRemove={() => void bulkRemoveSelection()}
                        />
                        <div className="min-h-0 flex-1 overflow-auto pr-2">
                            {favoriteLoadStatus === 'running' && !contentItems.length ? (
                                <FavoritesLoadingState title="Loading favorites baseline." />
                            ) : favoriteLoadStatus === 'error' ? (
                                <FavoritesEmptyState
                                    title="Favorites failed to load"
                                    description={favoriteDetail || 'The favorites baseline did not finish loading.'}
                                />
                            ) : kind !== 'friend' &&
                              remoteEntityDetails.status === 'running' &&
                              !Object.keys(remoteEntityDetails.data).length &&
                              selectedSource === 'remote' ? (
                                <FavoritesLoadingState
                                    title={
                                        kind === 'avatar'
                                            ? 'Loading remote avatar details.'
                                            : 'Loading remote world details.'
                                    }
                                />
                            ) : !contentItems.length ? (
                                <FavoritesEmptyState
                                    title={isSearchActive ? 'No matches found' : 'No data'}
                                    description={isSearchActive ? 'Try a different search term.' : 'The selected group currently has no items.'}
                                />
                            ) : (
                                <div
                                    className="grid"
                                    style={{
                                        gap: `${Math.max(4, Math.round(8 * cardSpacing))}px`,
                                        gridTemplateColumns: `repeat(auto-fill,minmax(${Math.round(260 * cardScale)}px,1fr))`
                                    }}>
                                    {contentItems.map((item) => (
                                        <FavoriteCard
                                            key={item.key}
                                            item={item}
                                            editMode={editMode && !isSearchActive}
                                            selected={selectedKeysSet.has(item.key)}
                                            showGroupLabel={isSearchActive}
                                            cardScale={cardScale}
                                            cardSpacing={cardSpacing}
                                            removing={removingFavoriteKey === item.key}
                                            canSendInvite={canSendInvite}
                                            canBoop={canBoop}
                                            currentUserId={currentUserId}
                                            currentAvatarId={currentUserSnapshot?.currentAvatar || ''}
                                            onToggleSelect={(checked) => {
                                                setSelectedKeys((keys) =>
                                                    checked
                                                        ? Array.from(new Set([...keys, item.key]))
                                                        : keys.filter((key) => key !== item.key)
                                                );
                                            }}
                                            onRemoveLocal={handleRemoveLocalFavorite}
                                            onRemoveRemote={handleRemoveRemoteFavorite}
                                            onFriendLaunch={(entry) => void launchFavoriteFriendLocation(entry)}
                                            onFriendSelfInvite={(entry) => void selfInviteFavoriteFriendLocation(entry)}
                                            onFriendInvite={(entry) => void sendFavoriteFriendInvite(entry)}
                                            onFriendRequestInvite={(entry) => void requestFavoriteFriendInvite(entry)}
                                            onFriendBoop={(entry) => void sendFavoriteFriendBoop(entry)}
                                            onWorldNewInstance={(entry) => openWorldNewInstance(entry, false)}
                                            onWorldSelfInvite={(entry) => openWorldNewInstance(entry, true)}
                                            onAvatarSelect={(entry) => void selectFavoriteAvatar(entry)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
            </div>
        </div>
    );
}

export function FavoriteFriendsPage(props) {
    return <FavoritesPage kind="friend" {...props} />;
}

export function FavoriteWorldsPage(props) {
    return <FavoritesPage kind="world" {...props} />;
}

export function FavoriteAvatarsPage(props) {
    return <FavoritesPage kind="avatar" {...props} />;
}
