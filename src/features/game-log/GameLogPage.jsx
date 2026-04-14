import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    CalendarRangeIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    FileTextIcon,
    LoaderCircleIcon,
    LogInIcon,
    LogOutIcon,
    LogsIcon,
    RefreshCwIcon,
    SearchIcon,
    StarIcon,
    Table2Icon,
    Trash2Icon,
    VideoIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';
import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';

import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    configRepository,
    GAME_LOG_FILTER_TYPES,
    gameLogRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import {
    ResizableTableCell,
    ResizableTableHead
} from '@/components/data-table/ResizableTableParts.jsx';
import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog.jsx';
import { Location } from '@/components/Location.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { formatDateFilter } from '@/lib/dateTime.js';
import { copyTextToClipboard, openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { openUserDialog, openWorldDialog } from '@/services/dialogService.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import { Calendar } from '@/ui/shadcn/calendar.jsx';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu.jsx';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import {
    TableBody,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table.jsx';
import { timeToText } from '@/lib/dateTime.js';

const DEFAULT_PAGE_SIZES = [10, 25, 50];
const DEFAULT_SORTING = [{ id: 'created_at', desc: true }];
const COLUMN_IDS = ['spacer', 'created_at', 'type', 'displayName', 'detail', 'action'];
const STRETCH_COLUMN_ID = 'detail';
const STORAGE_KEY = 'vrcx:table:gameLog';
const SESSION_FILTER_TYPES = ['Location', 'OnPlayerJoined', 'OnPlayerLeft', 'VideoPlay'];
const SESSION_DATE_RANGE_MAX_DAYS = 7;
const GAME_LOG_UNACTIONABLE_TYPES = new Set([
    'OnPlayerJoined',
    'OnPlayerLeft',
    'Location',
    'PortalSpawn'
]);
const GAME_LOG_DETAILLESS_TYPES = new Set([
    'OnPlayerJoined',
    'OnPlayerLeft',
    'Notification'
]);
const TYPE_LABELS = {
    Location: 'Location',
    OnPlayerJoined: 'Player Joined',
    OnPlayerLeft: 'Player Left',
    PortalSpawn: 'Portal Spawn',
    VideoPlay: 'Video Play',
    Event: 'Event',
    External: 'External',
    StringLoad: 'String Load',
    ImageLoad: 'Image Load'
};
function safeJsonParse(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function readPersistedState() {
    if (typeof window === 'undefined') {
        return {};
    }

    return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
}

function writePersistedState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    const current = readPersistedState();
    window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            ...current,
            ...patch,
            updatedAt: Date.now()
        })
    );
}

function sanitizeSorting(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_SORTING;
    }

    const filtered = value.filter(
        (entry) => entry && typeof entry.id === 'string' && COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : DEFAULT_SORTING;
}

function sanitizePageSizes(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(entry, 10))
                .filter((entry) => Number.isFinite(entry) && entry > 0)
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : DEFAULT_PAGE_SIZES;
}

function sanitizeColumnVisibility(value) {
    const visibility = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }

    for (const columnId of COLUMN_IDS) {
        if (typeof value[columnId] === 'boolean') {
            visibility[columnId] = value[columnId];
        }
    }

    return visibility;
}

function sanitizeColumnOrder(value) {
    if (!Array.isArray(value)) {
        return COLUMN_IDS;
    }

    const orderedColumns = value.filter((columnId) => COLUMN_IDS.includes(columnId));
    const missingColumns = COLUMN_IDS.filter((columnId) => !orderedColumns.includes(columnId));
    const nextColumns = [...orderedColumns, ...missingColumns];
    return ['spacer', ...nextColumns.filter((columnId) => columnId !== 'spacer')];
}

function sanitizeColumnSizing(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const columnId of COLUMN_IDS) {
        const width = Number.parseInt(value[columnId], 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
}

function resolvePageSize(candidate, allowed, fallback = DEFAULT_PAGE_SIZES[1]) {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        if (allowed.includes(parsed)) {
            return parsed;
        }

        if (allowed.includes(fallback)) {
            return fallback;
        }

        return allowed[0] ?? DEFAULT_PAGE_SIZES[0];
    }

    if (allowed.includes(fallback)) {
        return fallback;
    }

    return allowed[0] ?? DEFAULT_PAGE_SIZES[0];
}

function normalizeId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function parseDateInput(value) {
    const normalizedValue = normalizeId(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return undefined;
    }
    const [year, month, day] = normalizedValue.split('-').map((part) => Number.parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.valueOf()) ? undefined : date;
}

function toDateInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isoToDateInputValue(value) {
    const normalized = normalizeId(value);
    if (!normalized) {
        return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return normalized;
    }
    const date = new Date(normalized);
    return toDateInputValue(date);
}

function toIsoRangeStart(value) {
    const date = parseDateInput(value);
    if (!date) {
        return '';
    }
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
}

function toIsoRangeEnd(value) {
    const date = parseDateInput(value);
    if (!date) {
        return '';
    }
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
}

function addCalendarDays(date, days) {
    const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
}

function clampSessionDateInputRange(from, to) {
    const startInput = normalizeId(from);
    const endInput = normalizeId(to);
    const startDate = parseDateInput(startInput);
    const endDate = parseDateInput(endInput);
    if (!startDate || !endDate) {
        return [startInput, endInput];
    }

    const lowerDate = startDate <= endDate ? startDate : endDate;
    const upperDate = startDate <= endDate ? endDate : startDate;
    const maxUpperDate = addCalendarDays(lowerDate, SESSION_DATE_RANGE_MAX_DAYS);
    if (upperDate <= maxUpperDate) {
        return [toDateInputValue(lowerDate), toDateInputValue(upperDate)];
    }

    return [toDateInputValue(lowerDate), toDateInputValue(maxUpperDate)];
}

function buildFavoriteIdSet(localFriendFavorites) {
    const ids = new Set();
    for (const groupIds of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(groupIds)) {
            continue;
        }
        for (const id of groupIds) {
            const normalized = normalizeId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}

function describeGameLogDetail(row) {
    switch (row?.type) {
        case 'Location':
            return {
                primary: row?.worldName || row?.location || '',
                secondary: ''
            };
        case 'PortalSpawn':
            return {
                primary: row?.worldName || row?.instanceId || '',
                secondary: ''
            };
        case 'OnPlayerJoined':
        case 'OnPlayerLeft':
        case 'Notification':
            return {
                primary: '',
                secondary: ''
            };
        case 'VideoPlay': {
            const videoLabel = row?.videoName || row?.videoUrl || '';
            const leading = row?.videoId ? `${row.videoId}: ${videoLabel}` : videoLabel;
            return {
                primary: leading,
                secondary: ''
            };
        }
        case 'Event':
            return {
                primary: row?.data || '',
                secondary: ''
            };
        case 'External':
            return {
                primary: row?.message || '',
                secondary: ''
            };
        case 'StringLoad':
        case 'ImageLoad':
            return {
                primary: row?.resourceUrl || '',
                secondary: ''
            };
        default:
            return {
                primary: row?.message || row?.data || row?.location || '',
                secondary: ''
            };
    }
}

function resolveWorldTarget(row) {
    if (row?.type === 'PortalSpawn') {
        const portalLocation = normalizeId(row?.instanceId) || normalizeId(row?.location);
        if (parseLocation(portalLocation).worldId) {
            return portalLocation;
        }
    }

    const directLocation = normalizeId(row?.location);
    if (parseLocation(directLocation).worldId) {
        return directLocation;
    }

    const directWorldId = normalizeId(row?.worldId);
    if (directWorldId) {
        return directWorldId;
    }

    const directInstance = normalizeId(row?.instanceId);
    return parseLocation(directInstance).worldId ? directInstance : '';
}

function resolveWorldId(row) {
    const target = resolveWorldTarget(row);
    return parseLocation(target).worldId || normalizeId(row?.worldId);
}

function shouldLinkPrimaryDetailToWorld(row) {
    return (
        row?.type === 'Location' ||
        row?.type === 'PortalSpawn'
    );
}

function getGameLogLocationTarget(row) {
    if (row?.type === 'PortalSpawn') {
        return normalizeId(row?.instanceId) || normalizeId(row?.location);
    }
    return normalizeId(row?.location) || normalizeId(row?.instanceId);
}

function getGameLogExternalTarget(row) {
    if (row?.type === 'VideoPlay') {
        if (row?.videoId === 'LSMedia' || row?.videoId === 'PopcornPalace') {
            return '';
        }
        return row?.videoUrl || '';
    }

    if (row?.type === 'StringLoad' || row?.type === 'ImageLoad') {
        return row?.resourceUrl || '';
    }

    return '';
}

function getGameLogCopyTarget(row) {
    if (GAME_LOG_DETAILLESS_TYPES.has(row?.type)) {
        return '';
    }

    if (row?.type === 'Event') {
        return row?.data || '';
    }

    if (row?.type === 'VideoPlay') {
        return row?.videoUrl || row?.videoName || row?.data || '';
    }

    if (row?.type === 'StringLoad' || row?.type === 'ImageLoad') {
        return row?.resourceUrl || '';
    }

    return row?.data || row?.message || '';
}

async function openGameLogUser(row) {
    const userId = normalizeId(row?.userId);
    const displayName = normalizeId(row?.displayName);
    if (userId) {
        openUserDialog({ userId, title: displayName || undefined });
        return;
    }
    if (!displayName) {
        return;
    }

    try {
        const lowerDisplayName = displayName.toLowerCase();
        const { auth } = useRuntimeStore.getState();
        const { friendsById } = useFriendRosterStore.getState();
        const localUser = [
            auth?.currentUserSnapshot,
            ...Object.values(friendsById || {})
        ].find((user) => {
            const name = normalizeId(user?.displayName || user?.username).toLowerCase();
            return name && name === lowerDisplayName;
        });
        if (localUser?.id) {
            openUserDialog({
                userId: localUser.id,
                title: localUser.displayName || displayName,
                seedData: localUser
            });
            return;
        }

        const resolvedUserId = normalizeId(
            await gameLogRepository.getUserIdFromDisplayName(displayName).catch(() => '')
        );
        if (resolvedUserId) {
            openUserDialog({ userId: resolvedUserId, title: displayName });
            return;
        }

        if (displayName.startsWith('ID:')) {
            toast.info(`No user id was found for ${displayName}.`);
            return;
        }

        const response = await vrchatSearchRepository.getUsers(
            {
                search: displayName,
                n: 5,
                offset: 0
            },
            { endpoint: auth?.currentUserEndpoint || '' }
        );
        const rows = Array.isArray(response.json) ? response.json : [];
        const match = rows.find((user) => normalizeId(user?.displayName).toLowerCase() === lowerDisplayName);
        if (match?.id) {
            openUserDialog({
                userId: match.id,
                title: match.displayName || displayName,
                seedData: match
            });
            return;
        }
        toast.info(`No user id was found for ${displayName}.`);
    } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to look up ${displayName}.`);
    }
}

function canDeleteGameLogRow(row) {
    return Boolean(row?.type && !GAME_LOG_UNACTIONABLE_TYPES.has(row.type));
}

function getGameLogRowKey(row) {
    return [
        row?.type,
        row?.created_at,
        row?.videoUrl,
        row?.data,
        row?.message,
        row?.resourceUrl,
        row?.location,
        row?.rowId,
        row?.id
    ]
        .map((value) => normalizeId(value))
        .filter(Boolean)
        .join(':');
}

function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <button
            type="button"
            className="inline-flex items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => column.toggleSorting(direction === 'asc')}>
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon className="size-3.5" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon className="size-3.5" />
            ) : (
                <ArrowUpDownIcon className="size-3.5" />
            )}
        </button>
    );
}

function getGameLogColumnStyle(column) {
    if (column?.id !== STRETCH_COLUMN_ID) {
        return undefined;
    }

    return { width: undefined };
}

function GameLogEmptyState({ title, description }) {
    return (
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-sm space-y-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function EmptyTableValue() {
    return null;
}

function GameLogLocationDetail({ row, detailValue, worldTarget, onPreviousInstances }) {
    const location = getGameLogLocationTarget(row);
    const targetLocation = location || worldTarget;

    if (!targetLocation) {
        return (
            <div
                className="flex min-w-0 items-center gap-1.5 text-sm"
                title={[detailValue.primary, detailValue.secondary].filter(Boolean).join(' · ')}>
                <span className="min-w-0 truncate">{detailValue.primary}</span>
                {detailValue.secondary ? (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {detailValue.secondary}
                    </span>
                ) : null}
            </div>
        );
    }

    return (
        <div
            className="flex min-w-0 items-center gap-1.5 text-sm"
            title={[detailValue.primary, detailValue.secondary].filter(Boolean).join(' · ')}>
            <Location
                location={targetLocation}
                hint={row?.worldName || detailValue.primary}
                grouphint={row?.groupName || ''}
                enableContextMenu
                showLaunchActions
                onShowPreviousInstances={() => void onPreviousInstances?.(row)}
                className="text-sm"
            />
            {detailValue.secondary ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {detailValue.secondary}
                </span>
            ) : null}
        </div>
    );
}

function annotateSessionMember(member, favoriteIdSet, friendIdSet) {
    const userId = normalizeId(member?.userId);
    return {
        ...member,
        isFavorite: userId ? favoriteIdSet.has(userId) : false,
        isFriend: userId ? friendIdSet.has(userId) : false
    };
}

function annotateSessionEvent(event, favoriteIdSet, friendIdSet) {
    const userId = normalizeId(event?.userId);
    return {
        ...event,
        isFavorite: userId ? favoriteIdSet.has(userId) : Boolean(event?.isFavorite),
        isFriend: userId ? friendIdSet.has(userId) : Boolean(event?.isFriend),
        members: Array.isArray(event?.members)
            ? event.members.map((member) => annotateSessionMember(member, favoriteIdSet, friendIdSet))
            : []
    };
}

function countSessionEvent(events, type) {
    return events.reduce((count, event) => {
        if (type === 'OnPlayerJoined' && event.type === 'JoinGroup') {
            return count + (event.members?.length || event.count || 0);
        }
        if (type === 'OnPlayerLeft' && event.type === 'LeftGroup') {
            return count + (event.members?.length || event.count || 0);
        }
        return count + (event.type === type ? 1 : 0);
    }, 0);
}

function resolveSessionDuration(session) {
    const duration = Number(session?.duration ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function TypeFilterDropdown({ types, selectedTypes, onSelectedTypesChange }) {
    const { t } = useI18n();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="min-w-44 justify-between">
                    <span>
                        {selectedTypes.length
                            ? `${selectedTypes.length}/${types.length}`
                            : t('view.game_log.filter_placeholder')}
                    </span>
                    <ChevronRightIcon className="size-4 rotate-90 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onSelect={() => onSelectedTypesChange([])}>
                    {t('view.search.avatar.all')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {types.map((type) => (
                    <DropdownMenuCheckboxItem
                        key={type}
                        checked={selectedTypes.includes(type)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) => {
                            onSelectedTypesChange(
                                checked
                                    ? [...selectedTypes, type]
                                    : selectedTypes.filter((entry) => entry !== type)
                            );
                        }}>
                        {t(`view.game_log.filters.${type}`)}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function TypeFilterToggleGroup({
    types,
    selectedTypes,
    onSelectedTypesChange,
    className = 'flex min-w-0 flex-wrap items-center gap-1'
}) {
    const { t } = useI18n();

    function toggleType(type) {
        const nextTypes = selectedTypes.includes(type)
            ? selectedTypes.filter((entry) => entry !== type)
            : [...selectedTypes, type];

        onSelectedTypesChange(nextTypes.length === types.length ? [] : nextTypes);
    }

    return (
        <div className={className}>
            <Button
                type="button"
                variant={selectedTypes.length === 0 ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSelectedTypesChange([])}>
                {t('view.search.avatar.all')}
            </Button>
            {types.map((type) => (
                <Button
                    key={type}
                    type="button"
                    variant={selectedTypes.includes(type) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleType(type)}>
                    {t(`view.game_log.filters.${type}`)}
                </Button>
            ))}
        </div>
    );
}

function renderSessionMember(member) {
    const displayName = member?.displayName || '';
    const userId = normalizeId(member?.userId);
    const canOpenUser = Boolean(userId || member?.displayName);

    return (
        <div
            key={`${userId}:${member?.created_at || displayName}`}
            className="flex items-center gap-1 rounded px-2 py-px text-[0.8125rem] text-muted-foreground hover:bg-muted/30">
            {canOpenUser ? (
                <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-[0.8125rem]"
                    onClick={() => void openGameLogUser(member)}>
                    {displayName}
                </Button>
            ) : (
                <span>{displayName}</span>
            )}
            {member?.isFriend ? <span>{member?.isFavorite ? '⭐' : '💚'}</span> : null}
        </div>
    );
}

function SessionEventRow({ event }) {
    const { t } = useI18n();
    const isJoin = event.type === 'OnPlayerJoined' || event.type === 'JoinGroup';
    const isLeave = event.type === 'OnPlayerLeft' || event.type === 'LeftGroup';
    const isVideo = event.type === 'VideoPlay';
    const [isExpanded, setIsExpanded] = useState(false);
    const userId = normalizeId(event?.userId);
    const displayName = event?.displayName || '';
    const eventLabel = event.type === 'JoinGroup'
        ? TYPE_LABELS.OnPlayerJoined
        : event.type === 'LeftGroup'
            ? TYPE_LABELS.OnPlayerLeft
            : TYPE_LABELS[event.type] || event.type || '';
    const EventIcon = isJoin ? LogInIcon : isLeave ? LogOutIcon : isVideo ? VideoIcon : LogsIcon;
    const groupMembers = Array.isArray(event?.members) ? event.members : [];
    const isGroup = event.type === 'JoinGroup' || event.type === 'LeftGroup';
    const videoLabel = event?.videoName || event?.videoUrl || event?.videoId || 'Unknown Video';
    const showVideoLink = isVideo && event?.videoUrl && event.videoId !== 'LSMedia' && event.videoId !== 'PopcornPalace';

    if (isGroup) {
        const count = groupMembers.length || event?.count || 0;

        return (
            <div className="py-0.5">
                <button
                    type="button"
                    className="flex min-h-7 w-full cursor-pointer items-center gap-1.5 rounded border-none bg-transparent px-2 py-0.5 text-left text-[0.8125rem] text-muted-foreground hover:bg-muted/50"
                    onClick={() => setIsExpanded((current) => !current)}>
                    <span className="min-w-[5.5rem] shrink-0 text-[0.75rem] tabular-nums text-muted-foreground">
                        {formatDateFilter(event?.created_at, 'short')}
                    </span>
                    <div className="min-w-[7rem] shrink-0">
                        <Badge variant="outline" className="justify-center text-muted-foreground">
                            {eventLabel}
                        </Badge>
                    </div>
                    <span className="flex-1 font-medium">
                        {count} player{count === 1 ? '' : 's'} {isJoin ? 'joined' : 'left'}
                    </span>
                    <ChevronRightIcon
                        className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${
                            isExpanded ? 'rotate-90' : ''
                        }`}
                    />
                </button>
                {isExpanded ? (
                    <div className="py-0.5 pb-1 pl-20">
                        {groupMembers.map(renderSessionMember)}
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className={`py-0.5 ${isLeave ? 'text-muted-foreground' : ''}`}>
            <div className="flex min-h-7 items-center gap-1.5 rounded px-2 py-0.5 text-[0.8125rem] hover:bg-muted/50">
                <span className="min-w-[5.5rem] shrink-0 text-[0.75rem] tabular-nums text-muted-foreground">
                    {formatDateFilter(event?.created_at, 'short')}
                </span>
                <div className="min-w-[7rem] shrink-0">
                    <Badge variant="outline" className="justify-center text-muted-foreground">
                        {eventLabel}
                    </Badge>
                </div>

                {isVideo ? (
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div className="flex min-w-0 flex-1 cursor-default items-center gap-1 truncate text-left">
                                <VideoIcon className="shrink-0 text-xs" />
                                {showVideoLink ? (
                                    <button
                                        type="button"
                                        className="min-w-0 truncate text-left"
                                        onClick={(eventObject) => {
                                            eventObject.stopPropagation();
                                            void openExternalLink(event.videoUrl);
                                        }}>
                                        {videoLabel}
                                    </button>
                                ) : (
                                    <span className="truncate">{videoLabel}</span>
                                )}
                                {event?.playCount > 1 ? (
                                    <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[0.625rem]">
                                        {t('view.game_log.sessions.play_count', { count: event.playCount })}
                                    </Badge>
                                ) : null}
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            {showVideoLink ? (
                                <>
                                    <ContextMenuItem onSelect={() => void openExternalLink(event.videoUrl)}>
                                        <ExternalLinkIcon className="size-4" />
                                        {t('common.actions.open_link')}
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                </>
                            ) : null}
                            <ContextMenuItem onSelect={() => void copyTextToClipboard(event?.videoUrl || videoLabel)}>
                                <CopyIcon className="size-4" />
                                {t('common.actions.copy')}
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                    ) : (
                        <button
                            type="button"
                            className={`flex min-w-0 flex-1 items-center gap-1 truncate text-left ${userId || event?.displayName ? 'cursor-pointer' : 'cursor-default'}`}
                            onClick={() => void openGameLogUser(event)}>
                            <EventIcon className="shrink-0 text-xs" />
                            <span className="truncate">{displayName}</span>
                        {event?.isFriend ? (
                            <span className="ml-1">{event?.isFavorite ? '⭐' : '💚'}</span>
                        ) : null}
                    </button>
                )}

                {isVideo && event?.displayName ? (
                    <span className="shrink-0 text-[0.75rem] text-muted-foreground">{event.displayName}</span>
                ) : null}
            </div>
        </div>
    );
}

function GameLogSessionSegment({
    session,
    isLast,
    isLatest,
    isGameRunning,
    collapsed = false,
    onCollapsedChange
}) {
    const { t } = useI18n();
    const worldTarget = resolveWorldTarget(session);
    const joinedCount = countSessionEvent(session.events, 'OnPlayerJoined');
    const leftCount = countSessionEvent(session.events, 'OnPlayerLeft');
    const videoCount = countSessionEvent(session.events, 'VideoPlay');
    const durationMs = resolveSessionDuration(session);
    const sessionStartedAt = Date.parse(session?.created_at);
    const shouldShowLiveDuration =
        durationMs <= 0 &&
        isLatest &&
        isGameRunning &&
        Number.isFinite(sessionStartedAt);
    const [liveNow, setLiveNow] = useState(() => Date.now());
    const liveDurationMs = shouldShowLiveDuration
        ? Math.max(0, liveNow - sessionStartedAt)
        : 0;
    const durationText =
        durationMs > 0
            ? timeToText(durationMs)
            : liveDurationMs > 0
                ? timeToText(liveDurationMs)
                : '';
    const sessionLocation = session.location || '';
    const toggleCollapsed = () => onCollapsedChange?.(!collapsed);

    useEffect(() => {
        if (!shouldShowLiveDuration) {
            return undefined;
        }
        const timerId = window.setInterval(() => setLiveNow(Date.now()), 30_000);
        return () => {
            window.clearInterval(timerId);
        };
    }, [shouldShowLiveDuration]);

    return (
        <div className={`border-b border-border ${isLast ? 'border-b-0' : ''}`}>
            <div
                role="button"
                tabIndex={0}
                className="sticky top-0 z-[5] flex w-full cursor-pointer items-center gap-2 border-b border-border bg-muted/80 px-3 py-2 text-left transition-colors hover:bg-muted"
                onClick={toggleCollapsed}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleCollapsed();
                    }
                }}>
                <ChevronRightIcon
                    className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${
                        collapsed ? '' : 'rotate-90'
                    }`}
                />
                <div className="min-w-0 flex-1">
                    {sessionLocation ? (
                        <Location
                            location={sessionLocation}
                            hint={session.worldName || worldTarget}
                            grouphint={session.groupName || ''}
                            enableContextMenu
                            stopPropagation
                            className="text-sm"
                        />
                    ) : (
                        <span className="truncate text-sm" />
                    )}
                </div>
                <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                    {formatDateFilter(session.created_at, 'long')}
                </span>
                {durationText ? (
                    <Badge
                        variant="outline"
                        className="h-4 shrink-0 px-1 text-[0.625rem] tabular-nums"
                        title="Time spent in this instance">
                        {durationText}
                    </Badge>
                ) : isLatest && isGameRunning ? (
                    <Badge variant="outline" className="h-4 shrink-0 px-1 text-[0.625rem]">
                        {t('common.current_session')}
                    </Badge>
                ) : null}
                <div className="ml-auto flex min-w-0 max-w-full shrink-0 items-center justify-end gap-2 text-[0.6875rem] text-muted-foreground">
                    {session.events?.length ? (
                        <>
                            {joinedCount ? (
                            <span className="flex items-center gap-0.5" title={TYPE_LABELS.OnPlayerJoined}>
                                <LogInIcon className="size-3" /> {joinedCount}
                            </span>
                            ) : null}
                            {leftCount ? (
                            <span className="flex items-center gap-0.5" title={TYPE_LABELS.OnPlayerLeft}>
                                <LogOutIcon className="size-3" /> {leftCount}
                            </span>
                            ) : null}
                            {videoCount ? (
                            <span className="flex items-center gap-0.5" title={TYPE_LABELS.VideoPlay}>
                                <VideoIcon className="size-3" /> {videoCount}
                            </span>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </div>

            {!collapsed && session.events?.length ? (
                <div className="px-1 py-1">
                    {session.events.map((event, index) => (
                        <SessionEventRow
                            key={`${event.type}:${event.created_at}:${event.userId || event.videoUrl || index}`}
                            event={event}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function getGameLogSessionKey(session) {
    return [
        session?.id,
        session?.created_at,
        session?.location
    ]
        .map((value) => normalizeId(value))
        .filter(Boolean)
        .join(':');
}

function GameLogSessionsView({
    sessions,
    isGameRunning,
    hasMore = false,
    isLoadingMore = false,
    autoFill = false,
    autoFillKey = '',
    onLoadMore
}) {
    const { t } = useI18n();
    const scrollRef = useRef(null);
    const sentinelRef = useRef(null);
    const [autoFillAttempts, setAutoFillAttempts] = useState(0);
    const [collapsedSessionIds, setCollapsedSessionIds] = useState(() => new Set());
    const sessionKeys = useMemo(
        () => sessions.map((session) => getGameLogSessionKey(session)).filter(Boolean),
        [sessions]
    );

    useEffect(() => {
        setAutoFillAttempts(0);
    }, [autoFillKey]);

    useEffect(() => {
        setCollapsedSessionIds((current) => {
            const nextKeys = new Set(sessionKeys);
            let changed = false;
            const nextCollapsedIds = new Set();

            for (const key of current) {
                if (nextKeys.has(key)) {
                    nextCollapsedIds.add(key);
                } else {
                    changed = true;
                }
            }

            return changed ? nextCollapsedIds : current;
        });
    }, [sessionKeys]);

    useEffect(() => {
        if (!hasMore || isLoadingMore || typeof onLoadMore !== 'function') {
            return undefined;
        }

        const root = scrollRef.current;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel || typeof IntersectionObserver !== 'function') {
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        onLoadMore();
                    }
                }
            },
            {
                root,
                rootMargin: '240px'
            }
        );

        observer.observe(sentinel);

        return () => {
            observer.disconnect();
        };
    }, [hasMore, isLoadingMore, onLoadMore, sessions.length]);

    useEffect(() => {
        if (!autoFill || !hasMore || isLoadingMore || autoFillAttempts >= 3 || typeof onLoadMore !== 'function') {
            return undefined;
        }

        const root = scrollRef.current;
        if (!root) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            if (root.scrollHeight <= root.clientHeight + 16) {
                setAutoFillAttempts((current) => current + 1);
                onLoadMore();
            }
        }, 0);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [autoFill, autoFillAttempts, hasMore, isLoadingMore, onLoadMore, sessions.length]);

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border">
            <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
                {sessions.map((session, index) => {
                    const sessionKey = getGameLogSessionKey(session);
                    return (
                        <GameLogSessionSegment
                            key={sessionKey || `session:${index}`}
                            session={session}
                            isLatest={index === 0}
                            isLast={index === sessions.length - 1}
                            isGameRunning={isGameRunning}
                            collapsed={collapsedSessionIds.has(sessionKey)}
                            onCollapsedChange={(nextCollapsed) => {
                                if (!sessionKey) {
                                    return;
                                }
                                setCollapsedSessionIds((current) => {
                                    const next = new Set(current);
                                    if (nextCollapsed) {
                                        next.add(sessionKey);
                                    } else {
                                        next.delete(sessionKey);
                                    }
                                    return next;
                                });
                            }}
                        />
                    );
                })}
                <div
                    ref={sentinelRef}
                    className="flex items-center justify-center py-4 pb-6 text-[0.8125rem] text-muted-foreground">
                    {isLoadingMore ? (
                        <>
                            <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
                            {t('common.load_more')}...
                        </>
                    ) : hasMore ? (
                        <span>{t('common.load_more')}...</span>
                    ) : (
                        <span>{t('common.no_more')}</span>
                    )}
                </div>
            </div>
        </div>
    );
}

export function GameLogPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const isGameRunning = useRuntimeStore((state) => Boolean(state.gameState.isGameRunning));
    const confirm = useModalStore((state) => state.confirm);
    const isFavoritesLoaded = useSessionStore((state) => state.isFavoritesLoaded);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const gameLogDisabled = usePreferencesStore((state) => state.gameLogDisabled);
    const tablePageSizesPreference = usePreferencesStore((state) => state.tablePageSizes);

    const persistedState = useMemo(() => readPersistedState(), []);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const preferencesReadyRef = useRef(false);
    const requestIdRef = useRef(0);

    const [rows, setRows] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);
    const [deletingGameLogKey, setDeletingGameLogKey] = useState('');
    const [previousInstancesOpen, setPreviousInstancesOpen] = useState(false);
    const [previousInstancesRows, setPreviousInstancesRows] = useState([]);
    const [previousInstancesTitle, setPreviousInstancesTitle] = useState('Previous Instances');
    const [previousInstancesAutoInfo, setPreviousInstancesAutoInfo] = useState(false);
    const [loadingPreviousInstancesKey, setLoadingPreviousInstancesKey] = useState('');
    const [shiftHeld, setShiftHeld] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [tableSelectedTypes, setTableSelectedTypes] = useState([]);
    const [sessionSelectedTypes, setSessionSelectedTypes] = useState([]);
    const [tableFavoritesOnly, setTableFavoritesOnly] = useState(false);
    const [sessionFavoritesOnly, setSessionFavoritesOnly] = useState(false);
    const [sessionDateFrom, setSessionDateFrom] = useState('');
    const [sessionDateTo, setSessionDateTo] = useState('');
    const [sessionDateDraftFrom, setSessionDateDraftFrom] = useState('');
    const [sessionDateDraftTo, setSessionDateDraftTo] = useState('');
    const [sessionDatePopoverOpen, setSessionDatePopoverOpen] = useState(false);
    const [pageSizes, setPageSizes] = useState(DEFAULT_PAGE_SIZES);
    const [sessionLimit, setSessionLimit] = useState(DEFAULT_PAGE_SIZES[1]);
    const [savedViewMode, setSavedViewMode] = useState('sessions');
    const [sorting, setSorting] = useState(() => sanitizeSorting(persistedState.sorting));
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() => sanitizeColumnOrder(persistedState.columnOrder));
    const [columnSizing, setColumnSizing] = useState(() => sanitizeColumnSizing(persistedState.columnSizing));
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolvePageSize(
            persistedState.pageSize,
            DEFAULT_PAGE_SIZES,
            DEFAULT_PAGE_SIZES[1]
        )
    }));
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const sessionDateDraftRange = useMemo(() => {
        const from = parseDateInput(sessionDateDraftFrom);
        const to = parseDateInput(sessionDateDraftTo);
        return from || to ? { from, to } : undefined;
    }, [sessionDateDraftFrom, sessionDateDraftTo]);
    const todayDate = useMemo(() => new Date(), []);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Shift') {
                setShiftHeld(true);
            }
        }

        function handleKeyUp(event) {
            if (event.key === 'Shift') {
                setShiftHeld(false);
            }
        }

        function handleBlur() {
            setShiftHeld(false);
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(localFriendFavorites),
        [localFriendFavorites]
    );
    const friendIdSet = useMemo(() => new Set(Object.keys(friendsById || {})), [friendsById]);
    const availableFilterTypes = savedViewMode === 'sessions' ? SESSION_FILTER_TYPES : GAME_LOG_FILTER_TYPES;
    const tableQueryFilterTypes = useMemo(
        () => tableSelectedTypes.filter((type) => GAME_LOG_FILTER_TYPES.includes(type)),
        [tableSelectedTypes]
    );
    const sessionQueryFilterTypes = useMemo(
        () => sessionSelectedTypes.filter((type) => SESSION_FILTER_TYPES.includes(type)),
        [sessionSelectedTypes]
    );
    const queryFilterTypes = savedViewMode === 'sessions' ? sessionQueryFilterTypes : tableQueryFilterTypes;
    const favoritesOnly = savedViewMode === 'sessions' ? sessionFavoritesOnly : tableFavoritesOnly;
    const setActiveSelectedTypes = savedViewMode === 'sessions' ? setSessionSelectedTypes : setTableSelectedTypes;
    const setActiveFavoritesOnly = savedViewMode === 'sessions' ? setSessionFavoritesOnly : setTableFavoritesOnly;

    useEffect(() => {
        let active = true;

        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            configRepository.getInt('tablePageSize', DEFAULT_PAGE_SIZES[1]),
            configRepository.getString('gameLogTableFilters', '[]'),
            configRepository.getBool('VRCX_gameLogTableVIPFilter', false),
            configRepository.getString('gameLogSessionsFilters', '[]'),
            configRepository.getBool('VRCX_gameLogSessionsVIPFilter', false),
            configRepository.getString('gameLogSessionsDateFrom', ''),
            configRepository.getString('gameLogSessionsDateTo', ''),
            configRepository.getString('gameLogViewMode', 'sessions')
        ])
            .then(
                ([
                    nextPageSizes,
                    nextPageSize,
                    nextTableTypeFilters,
                    nextTableFavoritesOnly,
                    nextSessionTypeFilters,
                    nextSessionFavoritesOnly,
                    nextSessionDateFrom,
                    nextSessionDateTo,
                    nextSavedViewMode
                ]) => {
                    if (!active) {
                        return;
                    }

                    const resolvedPageSizes = sanitizePageSizes(nextPageSizes);
                    const parsedPersistedPageSize = Number.parseInt(persistedState.pageSize, 10);
                    const hasPersistedPageSize =
                        Number.isFinite(parsedPersistedPageSize) && parsedPersistedPageSize > 0;
                    const resolvedConfiguredPageSize = resolvePageSize(
                        nextPageSize,
                        resolvedPageSizes,
                        DEFAULT_PAGE_SIZES[1]
                    );
                    const resolvedActivePageSize = hasPersistedPageSize
                        ? resolvePageSize(
                            parsedPersistedPageSize,
                            resolvedPageSizes,
                            resolvedConfiguredPageSize
                        )
                        : resolvedConfiguredPageSize;

                    setPageSizes((current) =>
                        sanitizePageSizes([
                            ...current,
                            ...resolvedPageSizes,
                            resolvedConfiguredPageSize,
                            resolvedActivePageSize
                        ])
                    );
                    setPagination((current) => ({
                        ...current,
                        pageSize: resolvedActivePageSize
                    }));
                    setSessionLimit(resolvedActivePageSize);

                    const parsedTableFilters = safeJsonParse(nextTableTypeFilters);
                    const parsedSessionFilters = safeJsonParse(nextSessionTypeFilters);
                    setTableSelectedTypes(
                        Array.isArray(parsedTableFilters)
                            ? parsedTableFilters.filter((entry) => GAME_LOG_FILTER_TYPES.includes(entry))
                            : []
                    );
                    setSessionSelectedTypes(
                        Array.isArray(parsedSessionFilters)
                            ? parsedSessionFilters.filter((entry) => SESSION_FILTER_TYPES.includes(entry))
                            : []
                    );
                    setTableFavoritesOnly(Boolean(nextTableFavoritesOnly));
                    setSessionFavoritesOnly(Boolean(nextSessionFavoritesOnly));
                    setSessionDateFrom(String(nextSessionDateFrom || ''));
                    setSessionDateTo(String(nextSessionDateTo || ''));
                    setSessionDateDraftFrom(isoToDateInputValue(nextSessionDateFrom));
                    setSessionDateDraftTo(isoToDateInputValue(nextSessionDateTo));
                    setSavedViewMode(
                        nextSavedViewMode === 'sessions' || nextSavedViewMode === 'table'
                            ? nextSavedViewMode
                            : 'table'
                    );
                    preferencesReadyRef.current = true;
                }
            )
            .catch(() => {
                if (!active) {
                    return;
                }
                preferencesReadyRef.current = true;
            });

        return () => {
            active = false;
        };
    }, [persistedState.pageSize]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const resolvedPageSizes = sanitizePageSizes(tablePageSizesPreference);
        setPageSizes(resolvedPageSizes);
        setPagination((current) => ({
            ...current,
            pageIndex: 0,
            pageSize: resolvePageSize(current.pageSize, resolvedPageSizes)
        }));
        setSessionLimit((current) => resolvePageSize(current, resolvedPageSizes));
    }, [preferencesHydrated, tablePageSizesPreference]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }

        void configRepository.setString('VRCX_gameLogTableFilters', JSON.stringify(tableSelectedTypes));
    }, [tableSelectedTypes]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }

        void configRepository.setBool('VRCX_gameLogTableVIPFilter', tableFavoritesOnly);
    }, [tableFavoritesOnly]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }

        void configRepository.setString('VRCX_gameLogSessionsFilters', JSON.stringify(sessionSelectedTypes));
    }, [sessionSelectedTypes]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }

        void configRepository.setBool('VRCX_gameLogSessionsVIPFilter', sessionFavoritesOnly);
    }, [sessionFavoritesOnly]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }

        void configRepository.setString('VRCX_gameLogSessionsDateFrom', sessionDateFrom);
    }, [sessionDateFrom]);

    useEffect(() => {
        if (!preferencesReadyRef.current) {
            return;
        }

        void configRepository.setString('VRCX_gameLogSessionsDateTo', sessionDateTo);
    }, [sessionDateTo]);

    useEffect(() => {
        setSearchDraft(searchQuery);
    }, [searchQuery]);

    useEffect(() => {
        if (sessionDatePopoverOpen) {
            return;
        }

        setSessionDateDraftFrom(isoToDateInputValue(sessionDateFrom));
        setSessionDateDraftTo(isoToDateInputValue(sessionDateTo));
    }, [sessionDateFrom, sessionDatePopoverOpen, sessionDateTo]);

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }

        writePersistedState({
            sorting: sanitizeSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }

        writePersistedState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }

        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility),
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing)
        });
    }, [columnOrder, columnSizing, columnVisibility]);

    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
        setSessionLimit(pagination.pageSize);
    }, [
        deferredSearchQuery,
        pagination.pageSize,
        savedViewMode,
        sessionDateFrom,
        sessionDateTo,
        sessionFavoritesOnly,
        sessionSelectedTypes,
        tableFavoritesOnly,
        tableSelectedTypes
    ]);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (!preferencesReadyRef.current || !currentUserId) {
            if (!currentUserId) {
                setRows([]);
                setSessions([]);
                setLoadStatus('idle');
                setDetail('No authenticated user is available for the game log snapshot.');
            }
            return;
        }

        if (gameLogDisabled) {
            setRows([]);
            setSessions([]);
            setLoadStatus('idle');
            setDetail('Game log ingestion is disabled.');
            return;
        }

        if (favoritesOnly && !isFavoritesLoaded) {
            setRows([]);
            setSessions([]);
            setLoadStatus('idle');
            setDetail('Favorites are still hydrating.');
            return;
        }

        const favoriteUserIds = favoritesOnly ? Array.from(favoriteIdSet) : [];

        setLoadStatus('running');
        setDetail('');

        gameLogRepository[
            savedViewMode === 'sessions' ? 'queryLatestSessions' : 'queryGameLog'
        ]({
                search: deferredSearchQuery,
                filters: queryFilterTypes,
                favoriteUserIds,
                dateFrom: savedViewMode === 'sessions' ? sessionDateFrom : '',
                dateTo: savedViewMode === 'sessions' ? sessionDateTo : '',
                limit: savedViewMode === 'sessions' ? sessionLimit : pagination.pageSize
            })
            .then((nextResult) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                if (savedViewMode === 'sessions') {
                    setSessions(Array.isArray(nextResult) ? nextResult : []);
                    setRows([]);
                } else {
                    setRows(Array.isArray(nextResult) ? nextResult : []);
                    setSessions([]);
                }
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                setRows([]);
                setSessions([]);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the game log snapshot.'
                );
            });
    }, [
        addGameLogEventCount,
        currentUserId,
        deferredSearchQuery,
        favoriteIdSet,
        favoritesOnly,
        gameLogDisabled,
        isFavoritesLoaded,
        pagination.pageSize,
        queryFilterTypes,
        refreshToken,
        savedViewMode,
        sessionDateFrom,
        sessionDateTo,
        sessionLimit,
    ]);

    const annotatedSessions = useMemo(
        () =>
            sessions.map((session) => ({
                ...session,
                events: (session.events ?? []).map((event) =>
                    annotateSessionEvent(event, favoriteIdSet, friendIdSet)
                )
            })),
        [favoriteIdSet, friendIdSet, sessions]
    );

    const annotatedRows = useMemo(
        () =>
            rows.map((row) => {
                const normalizedUserId = normalizeId(row?.userId);
                return {
                    ...row,
                    isFavorite: normalizedUserId ? favoriteIdSet.has(normalizedUserId) : false,
                    isFriend: normalizedUserId ? friendIdSet.has(normalizedUserId) : false
                };
            }),
        [favoriteIdSet, friendIdSet, rows]
    );

    async function deleteGameLogRow(row, { skipConfirm = false } = {}) {
        if (!canDeleteGameLogRow(row)) {
            return;
        }

        const rowKey = getGameLogRowKey(row);
        if (!rowKey || deletingGameLogKey) {
            return;
        }

        if (!skipConfirm) {
            const detailValue = describeGameLogDetail(row);
            const result = await confirm({
                title: 'Delete game log row?',
                description: detailValue.primary || row.type || row.created_at,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                destructive: true
            });

            if (!result.ok) {
                return;
            }
        }

        setDeletingGameLogKey(rowKey);
        try {
            await gameLogRepository.deleteGameLogEntry(row);
            setRows((currentRows) =>
                currentRows.filter((entry) => getGameLogRowKey(entry) !== rowKey)
            );
            toast.success('Game log row deleted.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete game log row.');
        } finally {
            setDeletingGameLogKey('');
        }
    }

    async function openPreviousInstancesForRow(row) {
        const rowKey = getGameLogRowKey(row);
        const worldId = resolveWorldId(row);
        if (!worldId || loadingPreviousInstancesKey) {
            return;
        }

        setPreviousInstancesAutoInfo(false);
        setLoadingPreviousInstancesKey(rowKey || worldId);
        try {
            const instances = await gameLogRepository.getPreviousInstancesByWorldId({ worldId });
            const currentLocation = normalizeId(row?.location);
            const sortedInstances = [...instances].sort((left, right) => {
                if (currentLocation) {
                    if (normalizeId(left?.location) === currentLocation) {
                        return -1;
                    }
                    if (normalizeId(right?.location) === currentLocation) {
                        return 1;
                    }
                }
                return Date.parse(right?.created_at || 0) - Date.parse(left?.created_at || 0);
            });
            setPreviousInstancesRows(sortedInstances);
            setPreviousInstancesTitle(
                `Previous Instances: ${row?.worldName || 'World'}`
            );
            setPreviousInstancesOpen(true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to load previous instances.'
            );
        } finally {
            setLoadingPreviousInstancesKey('');
        }
    }

    async function copyGameLogDetail(row) {
        const text = getGameLogCopyTarget(row);
        if (!text) {
            return;
        }

        await copyTextToClipboard(text);
        toast.success('Copied game log detail.');
    }

    useEffect(() => {
        const maxPageIndex = Math.max(0, Math.ceil(annotatedRows.length / pagination.pageSize) - 1);
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [annotatedRows.length, pagination.pageIndex, pagination.pageSize]);

    const columns = useMemo(
        () => [
            {
                id: 'spacer',
                size: 20,
                minSize: 0,
                maxSize: 20,
                enableSorting: false,
                enableResizing: false,
                header: () => null,
                cell: () => null
            },
            {
                id: 'created_at',
                size: 140,
                accessorFn: (row) => row?.created_at || '',
                header: ({ column }) => <SortButton column={column} label={t('table.gameLog.date')} />,
                sortingFn: (rowA, rowB) => {
                    const leftTs = Date.parse(rowA.original?.created_at ?? '');
                    const rightTs = Date.parse(rowB.original?.created_at ?? '');
                    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
                        return leftTs - rightTs;
                    }

                    return (
                        (Number.parseInt(rowA.original?.rowId ?? 0, 10) || 0) -
                        (Number.parseInt(rowB.original?.rowId ?? 0, 10) || 0)
                    );
                },
                cell: ({ row }) => {
                    const createdAt = row.original?.created_at || '';
                    return (
                        <span className="text-sm" title={formatDateFilter(createdAt, 'long')}>
                            {formatDateFilter(createdAt, 'short')}
                        </span>
                    );
                }
            },
            {
                id: 'type',
                size: 150,
                accessorFn: (row) => row?.type || '',
                header: ({ column }) => <SortButton column={column} label={t('table.gameLog.type')} />,
                cell: ({ row }) => {
                    const worldTarget = resolveWorldTarget(row.original);
                    const typeLabel = row.original?.type ? t(`view.game_log.filters.${row.original.type}`) : '';
                    if (row.original?.type !== 'Location' && worldTarget) {
                        return (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto p-0"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openWorldDialog({
                                        worldId: worldTarget,
                                        title: row.original?.worldName || worldTarget
                                    });
                                }}>
                                <Badge variant="outline" className="text-muted-foreground">
                                    {typeLabel}
                                </Badge>
                            </Button>
                        );
                    }

                    return (
                        <Badge variant="outline" className="text-muted-foreground">
                            {typeLabel}
                        </Badge>
                    );
                }
            },
            {
                id: 'displayName',
                size: 200,
                accessorFn: (row) => row?.displayName || row?.userId || '',
                header: ({ column }) => <SortButton column={column} label={t('table.gameLog.user')} />,
                sortingFn: (rowA, rowB) =>
                    String(rowA.original?.displayName || rowA.original?.userId || '').localeCompare(
                        String(rowB.original?.displayName || rowB.original?.userId || ''),
                        undefined,
                        { sensitivity: 'base' }
                ),
                cell: ({ row }) => {
                    const displayName = row.original?.displayName || '';
                    const userId = normalizeId(row.original?.userId);
                    const canOpenUser = Boolean(displayName && (userId || row.original?.displayName));
                    return (
                        <div className="flex min-w-0 items-center gap-1 text-sm">
                            {canOpenUser ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    className="h-auto min-w-0 p-0 text-left text-sm"
                                    onClick={() => void openGameLogUser(row.original)}>
                                    <span className="truncate">{displayName}</span>
                                </Button>
                            ) : (
                                <span className="truncate">{displayName}</span>
                            )}
                            {row.original?.isFriend ? (
                                <span className="shrink-0">{row.original?.isFavorite ? '⭐' : '💚'}</span>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'detail',
                minSize: 150,
                accessorFn: (row) => {
                    const detailValue = describeGameLogDetail(row);
                    return [detailValue.primary, detailValue.secondary].filter(Boolean).join(' ');
                },
                enableSorting: false,
                header: () => t('table.gameLog.detail'),
                cell: ({ row }) => {
                    const detailValue = describeGameLogDetail(row.original);
                    const worldTarget = resolveWorldTarget(row.original);
                    if (row.original?.type === 'Location' || row.original?.type === 'PortalSpawn') {
                        return (
                            <GameLogLocationDetail
                                row={row.original}
                                detailValue={detailValue}
                                worldTarget={worldTarget}
                                onPreviousInstances={(targetRow) => void openPreviousInstancesForRow(targetRow)}
                            />
                        );
                    }
                    if (GAME_LOG_DETAILLESS_TYPES.has(row.original?.type)) {
                        return <EmptyTableValue />;
                    }
                    const canOpenWorld = worldTarget && shouldLinkPrimaryDetailToWorld(row.original);
                    const externalTarget = getGameLogExternalTarget(row.original);
                    const copyTarget = getGameLogCopyTarget(row.original);
                    if (!detailValue.primary && !detailValue.secondary && !externalTarget && !copyTarget) {
                        return <EmptyTableValue />;
                    }
                    return (
                        <div
                            className="flex min-w-0 items-center gap-1.5 text-sm"
                            title={[detailValue.primary, detailValue.secondary].filter(Boolean).join(' · ')}>
                            {canOpenWorld ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    className="h-auto min-w-0 p-0 text-left text-sm"
                                    onClick={() =>
                                        openWorldDialog({
                                            worldId: worldTarget,
                                            title: row.original?.worldName || detailValue.primary || worldTarget
                                        })
                                    }>
                                    <span className="truncate">{detailValue.primary}</span>
                                </Button>
                            ) : (
                                <span className="min-w-0 truncate">{detailValue.primary}</span>
                            )}
                            {detailValue.secondary ? (
                                <span className="min-w-0 truncate text-xs text-muted-foreground">
                                    {detailValue.secondary}
                                </span>
                            ) : null}
                            {externalTarget || copyTarget ? (
                                <div className="ml-auto flex shrink-0 items-center gap-1">
                                    {externalTarget ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="size-6 p-0"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void openExternalLink(externalTarget);
                                            }}>
                                            <ExternalLinkIcon className="size-3.5" />
                                        </Button>
                                    ) : null}
                                    {copyTarget ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="size-6 p-0"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void copyGameLogDetail(row.original);
                                            }}>
                                            <CopyIcon className="size-3.5" />
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'action',
                size: 90,
                minSize: 90,
                maxSize: 90,
                header: () => t('table.gameLog.action'),
                enableSorting: false,
                cell: ({ row }) => {
                    const rowKey = getGameLogRowKey(row.original);
                    const canDelete = canDeleteGameLogRow(row.original);
                    const canShowPrevious = row.original?.type === 'Location' && resolveWorldId(row.original);

                    if (!canDelete && !canShowPrevious) {
                        return <EmptyTableValue align="right" />;
                    }

                    return (
                        <div className="flex items-center justify-end gap-2">
                            {canDelete ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="size-6 p-0 text-muted-foreground hover:text-destructive"
                                    disabled={deletingGameLogKey === rowKey}
                                    onClick={(event) =>
                                        void deleteGameLogRow(row.original, {
                                            skipConfirm: shiftHeld || event.shiftKey
                                        })
                                    }>
                                    {deletingGameLogKey === rowKey ? (
                                        <LoaderCircleIcon className="size-4 animate-spin" />
                                    ) : shiftHeld ? (
                                        <XIcon className="size-4 text-destructive" />
                                    ) : (
                                        <Trash2Icon className="size-4" />
                                    )}
                                </Button>
                            ) : null}
                            {canShowPrevious ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="size-6 p-0 text-muted-foreground hover:text-foreground"
                                    disabled={loadingPreviousInstancesKey === rowKey}
                                    onClick={() => void openPreviousInstancesForRow(row.original)}>
                                    {loadingPreviousInstancesKey === rowKey ? (
                                        <LoaderCircleIcon className="size-4 animate-spin" />
                                    ) : (
                                        <FileTextIcon className="size-4" />
                                    )}
                                </Button>
                            ) : null}
                        </div>
                    );
                }
            }
        ],
        [deletingGameLogKey, loadingPreviousInstancesKey, shiftHeld, t]
    );

    const table = useReactTable({
        data: annotatedRows,
        columns,
        state: {
            columnOrder,
            columnSizing,
            columnVisibility,
            sorting,
            pagination
        },
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        enableColumnResizing: true,
        columnResizeMode: 'onChange'
    });

    const pageCount = Math.max(1, table.getPageCount());
    const isLoading =
        loadStatus === 'running' &&
        (savedViewMode === 'sessions' ? sessions.length === 0 : rows.length === 0);
    const isLoadingMoreSessions =
        loadStatus === 'running' && savedViewMode === 'sessions' && sessions.length > 0;
    const hasMoreSessions =
        savedViewMode === 'sessions' && sessions.length >= sessionLimit && sessionLimit < 1000;
    const isError =
        loadStatus === 'error' &&
        (savedViewMode === 'sessions' ? sessions.length === 0 : rows.length === 0);
    const hasRows = annotatedRows.length > 0;
    const hasSessions = annotatedSessions.length > 0;

    function commitSearchDraft() {
        setSearchQuery(searchDraft);
    }

    function syncSessionDateDraft() {
        setSessionDateDraftFrom(isoToDateInputValue(sessionDateFrom));
        setSessionDateDraftTo(isoToDateInputValue(sessionDateTo));
    }

    function updateSessionDateDraftRange(range) {
        const nextFrom = toDateInputValue(range?.from);
        const nextTo = toDateInputValue(range?.to);
        if (!nextFrom || !nextTo) {
            setSessionDateDraftFrom(nextFrom);
            setSessionDateDraftTo(nextTo);
            return;
        }

        const [clampedFrom, clampedTo] = clampSessionDateInputRange(nextFrom, nextTo);
        setSessionDateDraftFrom(clampedFrom);
        setSessionDateDraftTo(clampedTo);
    }

    function applySessionDateRange() {
        if (!sessionDateDraftFrom && !sessionDateDraftTo) {
            setSessionDateFrom('');
            setSessionDateTo('');
            setSessionDatePopoverOpen(false);
            return;
        }

        const [fromInput, toInput] = clampSessionDateInputRange(
            sessionDateDraftFrom || sessionDateDraftTo,
            sessionDateDraftTo || sessionDateDraftFrom
        );
        setSessionDateDraftFrom(fromInput);
        setSessionDateDraftTo(toInput);
        setSessionDateFrom(toIsoRangeStart(fromInput));
        setSessionDateTo(toIsoRangeEnd(toInput));
        setSessionDatePopoverOpen(false);
    }

    function clearSessionDateRange() {
        setSessionDateDraftFrom('');
        setSessionDateDraftTo('');
        setSessionDateFrom('');
        setSessionDateTo('');
        setSessionDatePopoverOpen(false);
    }

    function renderViewModeToggle() {
        return (
            <div className="flex shrink-0 rounded-md border p-0.5">
                <Button
                    type="button"
                    size="icon"
                    variant={savedViewMode === 'sessions' ? 'default' : 'ghost'}
                    title="Sessions"
                    onClick={() => {
                        setSavedViewMode('sessions');
                        void configRepository.setString('gameLogViewMode', 'sessions');
                    }}>
                    <LogsIcon className="size-4" />
                </Button>
                <Button
                    type="button"
                    size="icon"
                    variant={savedViewMode === 'table' ? 'default' : 'ghost'}
                    title="Table"
                    onClick={() => {
                        setSavedViewMode('table');
                        void configRepository.setString('gameLogViewMode', 'table');
                    }}>
                    <Table2Icon className="size-4" />
                </Button>
            </div>
        );
    }

    function renderFavoritesToggle() {
        return (
            <Button
                type="button"
                variant={favoritesOnly ? 'default' : 'outline'}
                size="icon"
                title="Favorites only"
                onClick={() => setActiveFavoritesOnly((current) => !current)}>
                <StarIcon className="size-4" />
            </Button>
        );
    }

    function renderSessionDateFilter() {
        return (
            <Popover
                open={sessionDatePopoverOpen}
                onOpenChange={(open) => {
                    if (open) {
                        syncSessionDateDraft();
                    }
                    setSessionDatePopoverOpen(open);
                }}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                            'h-8 shrink-0 gap-1.5',
                            (sessionDateFrom || sessionDateTo) && 'bg-accent text-accent-foreground'
                        )}
                        title="Session date range">
                        <CalendarRangeIcon className="size-4" />
                        {(sessionDateFrom || sessionDateTo) ? (
                            <Badge
                                variant="secondary"
                                className="ml-0.5 h-4.5 min-w-4.5 rounded-full px-1 text-xs">
                                1
                            </Badge>
                        ) : null}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto" align="start">
                    <Calendar
                        mode="range"
                        numberOfMonths={2}
                        max={SESSION_DATE_RANGE_MAX_DAYS}
                        selected={sessionDateDraftRange}
                        disabled={{ after: todayDate }}
                        onSelect={updateSessionDateDraftRange}
                    />
                    <div className="flex items-center justify-between gap-4 px-3 pb-3">
                        <div className="min-w-0 text-xs text-muted-foreground">
                            {[sessionDateDraftFrom || '...', sessionDateDraftTo || '...'].join(' - ')}
                            <span className="ml-2">Max {SESSION_DATE_RANGE_MAX_DAYS} days</span>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={clearSessionDateRange}>
                                {t('common.actions.clear')}
                            </Button>
                            <Button type="button" size="sm" onClick={applySessionDateRange}>
                                {t('common.actions.confirm')}
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        );
    }

    function renderSearchInput(className = 'relative min-w-56 flex-1') {
        return (
            <div className={className}>
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    onBlur={commitSearchDraft}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            commitSearchDraft();
                        }
                    }}
                    placeholder="Search"
                    className="pl-9 pr-9"
                />
                {searchDraft ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            setSearchDraft('');
                            setSearchQuery('');
                        }}>
                        <XIcon className="size-4" />
                    </Button>
                ) : null}
            </div>
        );
    }

    function renderTableControls() {
        return (
            <div className="flex shrink-0 items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Refresh"
                    disabled={!currentUserId || gameLogDisabled || loadStatus === 'running'}
                    onClick={() => setRefreshToken((value) => value + 1)}>
                    {loadStatus === 'running' ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                        <RefreshCwIcon className="size-4" />
                    )}
                </Button>
                {savedViewMode === 'table' ? <TableColumnVisibilityMenu table={table} /> : null}
                {savedViewMode === 'table' ? (
                    <Select
                        value={String(pagination.pageSize)}
                        onValueChange={(value) => {
                            const nextPageSize = resolvePageSize(value, pageSizes, pagination.pageSize);
                            setPagination({
                                pageIndex: 0,
                                pageSize: nextPageSize
                            });
                            setSessionLimit(nextPageSize);
                        }}>
                        <SelectTrigger className="w-24">
                            <SelectValue placeholder="Page size" />
                        </SelectTrigger>
                        <SelectContent>
                            {pageSizes.map((size) => (
                                <SelectItem key={size} value={String(size)}>
                                    {size}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : null}
            </div>
        );
    }

    return (
        <div
            className={
                embedded
                    ? 'flex h-full min-h-0 flex-col p-3'
                    : 'x-container x-container--auto-height flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-4 pb-0'
            }>
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                <div className="flex shrink-0 flex-col gap-2 border-b border-border pb-3">
                    {savedViewMode === 'table' ? (
                        <div className="overflow-hidden pb-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <div className="flex shrink-0 items-center gap-2">
                                    {renderViewModeToggle()}
                                    {renderFavoritesToggle()}
                                </div>
                                <div className="min-w-44">
                                    <TypeFilterDropdown
                                        types={availableFilterTypes}
                                        selectedTypes={queryFilterTypes}
                                        onSelectedTypesChange={setActiveSelectedTypes}
                                    />
                                </div>
                                {renderSearchInput('relative w-60 shrink-0')}
                                {renderTableControls()}
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-hidden pb-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                {renderViewModeToggle()}
                                {renderFavoritesToggle()}
                                {renderSessionDateFilter()}
                                <TypeFilterToggleGroup
                                    types={availableFilterTypes}
                                    selectedTypes={queryFilterTypes}
                                    onSelectedTypesChange={setActiveSelectedTypes}
                                    className="flex shrink-0 items-center gap-1"
                                />
                                {renderSearchInput('relative w-60 shrink-0')}
                                {renderTableControls()}
                            </div>
                        </div>
                    )}
                    {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                    {isLoading ? (
                        <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/20">
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <LoaderCircleIcon className="size-5 animate-spin" />
                                Loading the game log snapshot
                            </div>
                        </div>
                    ) : isError ? (
                        <GameLogEmptyState
                            title="Game log failed to load"
                            description={detail || 'The game log query did not complete.'}
                        />
                    ) : gameLogDisabled ? (
                        <GameLogEmptyState
                            title="Game log is disabled"
                            description="Enable game log ingestion in settings before this page can load local VRChat activity."
                        />
                    ) : savedViewMode === 'sessions' ? (
                        hasSessions ? (
                            <GameLogSessionsView
                                sessions={annotatedSessions}
                                isGameRunning={isGameRunning}
                                hasMore={hasMoreSessions}
                                isLoadingMore={isLoadingMoreSessions}
                                autoFill={Boolean(deferredSearchQuery.trim()) && !sessionDateFrom && !sessionDateTo}
                                autoFillKey={`${deferredSearchQuery}:${sessionDateFrom}:${sessionDateTo}:${queryFilterTypes.join(',')}:${favoritesOnly}`}
                                onLoadMore={() =>
                                    setSessionLimit((current) =>
                                        Math.min(current + pagination.pageSize, 1000)
                                    )
                                }
                            />
                        ) : (
                            <GameLogEmptyState
                                title="No game log sessions match the current filters"
                                description={
                                    favoritesOnly && !isFavoritesLoaded
                                        ? 'Favorites are still hydrating.'
                                        : 'Broaden the filters or search query to see more recent sessions.'
                                }
                            />
                        )
                    ) : hasRows ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-3">
                            <div className="vrcx-data-table min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border">
                                <table className="w-full table-fixed caption-bottom text-sm">
                                    <TableHeader>
                                        {table.getHeaderGroups().map((headerGroup) => (
                                            <TableRow key={headerGroup.id}>
                                                {headerGroup.headers.map((header) => (
                                                    <ResizableTableHead
                                                        key={header.id}
                                                        header={header}
                                                        style={getGameLogColumnStyle(header.column)}
                                                    />
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableHeader>
                                    <TableBody>
                                        {table.getRowModel().rows.map((row) => (
                                            <TableRow
                                                key={
                                                    row.original?.rowId != null
                                                        ? `${row.original.type}:${row.original.rowId}`
                                                        : row.id
                                                }>
                                                {row.getVisibleCells().map((cell) => (
                                                    <ResizableTableCell
                                                        key={cell.id}
                                                        cell={cell}
                                                        style={getGameLogColumnStyle(cell.column)}
                                                    />
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </table>
                            </div>

                            <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div className="text-sm text-muted-foreground">
                                    Showing{' '}
                                    <span className="font-medium text-foreground">
                                        {table.getRowModel().rows.length}
                                    </span>{' '}
                                    of{' '}
                                    <span className="font-medium text-foreground">
                                        {annotatedRows.length}
                                    </span>{' '}
                                    game log row{annotatedRows.length === 1 ? '' : 's'}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={!table.getCanPreviousPage()}
                                        onClick={() => table.previousPage()}>
                                        <ChevronLeftIcon className="size-4" />
                                        Previous
                                    </Button>
                                    <Badge variant="outline">
                                        Page {pagination.pageIndex + 1} / {pageCount}
                                    </Badge>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={!table.getCanNextPage()}
                                        onClick={() => table.nextPage()}>
                                        Next
                                        <ChevronRightIcon className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <GameLogEmptyState
                            title="No game log rows match the current filters"
                            description={
                                favoritesOnly && !isFavoritesLoaded
                                    ? 'Favorites are still hydrating.'
                                    : 'Broaden the filters or search query to see more results.'
                            }
                        />
                    )}
                </div>
            </div>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={setPreviousInstancesOpen}
                title={previousInstancesTitle}
                instances={previousInstancesRows}
                variant="world"
                onRowsChange={setPreviousInstancesRows}
                autoOpenInfo={previousInstancesAutoInfo}
            />
        </div>
    );
}
