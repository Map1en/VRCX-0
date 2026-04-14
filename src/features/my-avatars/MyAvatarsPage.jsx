import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    EyeIcon,
    ImageIcon,
    LayoutGridIcon,
    ListFilterIcon,
    ListIcon,
    LoaderCircleIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    SmartphoneIcon,
    TagIcon,
    UserIcon
} from 'lucide-react';
import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
import {
    ResizableTableCell,
    ResizableTableHead
} from '@/components/data-table/ResizableTableParts.jsx';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { getAvailablePlatforms, getPlatformInfo } from '@/lib/avatarPlatform.js';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { avatarProfileRepository, configRepository, mediaRepository, myAvatarRepository } from '@/repositories/index.js';
import { getTagColor } from '@/shared/constants/tags.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { getTablePageSizesPreference } from '@/services/preferencesService.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu.jsx';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from '@/ui/shadcn/popover.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import {
    Table,
    TableBody,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table.jsx';
import { openAvatarDialog } from '@/services/dialogService.js';
import { AvatarStylesDialog } from './AvatarStylesDialog.jsx';
import { ManageAvatarTagsDialog } from './ManageAvatarTagsDialog.jsx';

const DEFAULT_PAGE_SIZES = [10, 25, 50];
const DEFAULT_SORTING = [{ id: 'updated_at', desc: true }];
const STORAGE_KEY = 'vrcx:table:my-avatars';
const VIEW_MODES = ['grid', 'table'];
const RELEASE_STATUS_OPTIONS = ['all', 'public', 'private'];
const PLATFORM_OPTIONS = ['all', 'pc', 'android', 'ios'];
const DEFAULT_CARD_SCALE = 0.6;
const DEFAULT_CARD_SPACING = 1;
const COLUMN_ID_ALIASES = {
    releaseStatus: 'visibility',
    action: 'actions'
};
const SORT_COLUMN_IDS = ['name', 'customTags', 'visibility', 'timeSpent', 'version', 'pcPerf', 'androidPerf', 'iosPerf', 'updated_at', 'created_at'];
const COLUMN_IDS = [
    'active',
    'thumbnail',
    'name',
    'customTags',
    'platforms',
    'visibility',
    'timeSpent',
    'version',
    'pcPerf',
    'androidPerf',
    'iosPerf',
    'updated_at',
    'created_at',
    'actions'
];

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

function normalizeColumnId(columnId) {
    const normalized = typeof columnId === 'string' ? columnId.trim() : '';
    if (!normalized) {
        return '';
    }

    return COLUMN_ID_ALIASES[normalized] || normalized;
}

function sanitizeSorting(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_SORTING;
    }

    const allowedIds = new Set([
        ...SORT_COLUMN_IDS
    ]);
    const filtered = value
        .map((entry) =>
            entry && typeof entry.id === 'string'
                ? {
                    ...entry,
                    id: normalizeColumnId(entry.id)
                }
                : null
        )
        .filter((entry) => entry && allowedIds.has(entry.id));
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

function sanitizeCardScale(value) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
        return Math.min(1.4, Math.max(0.4, parsed));
    }
    return DEFAULT_CARD_SCALE;
}

function sanitizeCardSpacing(value) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
        return Math.min(2, Math.max(0.6, parsed));
    }
    return DEFAULT_CARD_SPACING;
}

function sanitizeColumnVisibility(value) {
    const visibility = {};
    if (value && typeof value === 'object') {
        for (const [rawColumnId, rawVisible] of Object.entries(value)) {
            const columnId = normalizeColumnId(rawColumnId);
            if (COLUMN_IDS.includes(columnId) && typeof rawVisible === 'boolean') {
                visibility[columnId] = rawVisible;
            }
        }
    }

    return visibility;
}

function sanitizeColumnOrder(value) {
    if (!Array.isArray(value)) {
        return [...COLUMN_IDS];
    }

    const ordered = [];
    for (const rawColumnId of value) {
        const columnId = normalizeColumnId(rawColumnId);
        if (COLUMN_IDS.includes(columnId) && !ordered.includes(columnId)) {
            ordered.push(columnId);
        }
    }

    for (const columnId of COLUMN_IDS) {
        if (!ordered.includes(columnId)) {
            ordered.push(columnId);
        }
    }

    return ordered;
}

function sanitizeColumnSizing(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const [rawColumnId, rawWidth] of Object.entries(value)) {
        const columnId = normalizeColumnId(rawColumnId);
        const width = Number.parseInt(rawWidth, 10);
        if (COLUMN_IDS.includes(columnId) && Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }

    return sizing;
}

function toggleTagFilter(currentTags, tag) {
    const next = new Set(currentTags);
    if (next.has(tag)) {
        next.delete(tag);
    } else {
        next.add(tag);
    }
    return next;
}

function matchesPlatformFilter(avatar, platformFilter) {
    if (platformFilter === 'all') {
        return true;
    }

    const platforms = getAvailablePlatforms(avatar?.unityPackages);
    return Boolean(platforms?.isPC && platformFilter === 'pc') ||
        Boolean(platforms?.isQuest && platformFilter === 'android') ||
        Boolean(platforms?.isIos && platformFilter === 'ios');
}

function SortButton({ column, label, descFirst = false }) {
    const direction = column.getIsSorted();

    return (
        <button
            type="button"
            className="inline-flex items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
                if (!direction && descFirst) {
                    column.toggleSorting(true);
                    return;
                }
                column.toggleSorting(direction === 'asc');
            }}>
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

function PlatformBadges({ unityPackages }) {
    const platforms = getAvailablePlatforms(unityPackages);

    return (
        <div className="flex items-center gap-1">
            {platforms?.isPC ? (
                <Badge variant="outline">
                    <MonitorIcon className="size-3.5" />
                </Badge>
            ) : null}
            {platforms?.isQuest ? (
                <Badge variant="outline">
                    <SmartphoneIcon className="size-3.5" />
                </Badge>
            ) : null}
            {platforms?.isIos ? <Badge variant="outline">iOS</Badge> : null}
        </div>
    );
}

function MyAvatarsEmptyState({ title, description }) {
    return (
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-sm space-y-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function openAvatarDetails(avatar) {
    const avatarId =
        typeof avatar?.id === 'string' ? avatar.id.trim() : String(avatar?.id ?? '').trim();
    if (!avatarId) {
        return;
    }

    openAvatarDialog({
        avatarId,
        title: avatar?.name || undefined,
        seedData: avatar ?? null
    });
}

function getAvatarPlatformInfo(avatar) {
    return getPlatformInfo(avatar?.unityPackages);
}

function resolvePerformanceLabel(value) {
    if (!value) {
        return '-';
    }

    return value;
}

function resolveActionDisabled(avatar, isUpdating) {
    return isUpdating || !avatar?.id;
}

function AvatarActionMenuItems({
    avatar,
    isActive,
    disabled,
    Item,
    Separator,
    onAction
}) {
    const releaseAction = avatar?.releaseStatus === 'public' ? 'makePrivate' : 'makePublic';

    const handleAction = (event, action) => {
        event?.preventDefault?.();
        onAction(action, avatar);
    };

    return (
        <>
            <Item onSelect={(event) => handleAction(event, 'details')}>
                <EyeIcon className="size-4" />
                View details
            </Item>
            <Item
                disabled={disabled || isActive}
                onSelect={(event) => handleAction(event, 'wear')}>
                <CheckIcon className="size-4" />
                Select avatar
            </Item>
            <Separator />
            <Item disabled={disabled} onSelect={(event) => handleAction(event, 'manageTags')}>
                <TagIcon className="size-4" />
                Manage tags
            </Item>
            <Separator />
            <Item disabled={disabled} onSelect={(event) => handleAction(event, releaseAction)}>
                <UserIcon className="size-4" />
                {avatar?.releaseStatus === 'public' ? 'Make private' : 'Make public'}
            </Item>
            <Item disabled={disabled} onSelect={(event) => handleAction(event, 'rename')}>
                <PencilIcon className="size-4" />
                Rename
            </Item>
            <Item disabled={disabled} onSelect={(event) => handleAction(event, 'changeDescription')}>
                <PencilIcon className="size-4" />
                Change description
            </Item>
            <Item disabled={disabled} onSelect={(event) => handleAction(event, 'changeTags')}>
                <PencilIcon className="size-4" />
                Change content tags
            </Item>
            <Item disabled={disabled} onSelect={(event) => handleAction(event, 'changeStyles')}>
                <PencilIcon className="size-4" />
                Change styles/author tags
            </Item>
            <Item disabled={disabled} onSelect={(event) => handleAction(event, 'changeImage')}>
                <ImageIcon className="size-4" />
                Change image
            </Item>
            <Item disabled={disabled} onSelect={(event) => handleAction(event, 'createImpostor')}>
                <RefreshCwIcon className="size-4" />
                Create impostor
            </Item>
        </>
    );
}

function AvatarActionsDropdown({
    avatar,
    isActive,
    isUpdating,
    onAction
}) {
    const disabled = resolveActionDisabled(avatar, isUpdating);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="rounded-full"
                    disabled={isUpdating}
                    onClick={(event) => event.stopPropagation()}>
                    {isUpdating ? (
                        <LoaderCircleIcon className="size-3.5 animate-spin" />
                    ) : (
                        <MoreHorizontalIcon className="size-4" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <AvatarActionMenuItems
                    avatar={avatar}
                    isActive={isActive}
                    disabled={disabled}
                    Item={DropdownMenuItem}
                    Separator={DropdownMenuSeparator}
                    onAction={onAction}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function MyAvatarFilterPopover({
    activeFilterCount,
    allTags,
    releaseStatusFilter,
    platformFilter,
    tagFilters,
    onReleaseStatusChange,
    onPlatformChange,
    onTagFiltersChange,
    onClearFilters
}) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
                    <ListFilterIcon className="size-4" />
                    Filter
                    {activeFilterCount ? (
                        <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 rounded-full px-1 text-xs">
                            {activeFilterCount}
                        </Badge>
                    ) : null}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
                <div className="flex flex-col gap-3">
                    <div className="space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">Visibility</div>
                        <div className="flex flex-wrap gap-1">
                            {RELEASE_STATUS_OPTIONS.map((option) => (
                                <Button
                                    key={option}
                                    type="button"
                                    size="sm"
                                    variant={releaseStatusFilter === option ? 'default' : 'outline'}
                                    onClick={() => onReleaseStatusChange(option)}>
                                    {option === 'all' ? 'All' : option === 'public' ? 'Public' : 'Private'}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">Platform</div>
                        <div className="flex flex-wrap gap-1">
                            {PLATFORM_OPTIONS.map((option) => (
                                <Button
                                    key={option}
                                    type="button"
                                    size="sm"
                                    variant={platformFilter === option ? 'default' : 'outline'}
                                    onClick={() => onPlatformChange(option)}>
                                    {option === 'all'
                                        ? 'All'
                                        : option === 'pc'
                                            ? 'PC'
                                            : option === 'android'
                                                ? 'Android'
                                                : 'iOS'}
                                </Button>
                            ))}
                        </div>
                    </div>
                    {allTags.length ? (
                        <div className="space-y-1.5">
                            <div className="text-xs font-medium text-muted-foreground">Tags</div>
                            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                                {allTags.map((tag) => {
                                    const color = getTagColor(tag);
                                    return (
                                        <Badge
                                            key={tag}
                                            variant={tagFilters.has(tag) ? 'default' : 'outline'}
                                            className="cursor-pointer select-none"
                                            style={
                                                tagFilters.has(tag)
                                                    ? {
                                                        backgroundColor: color.bg,
                                                        color: color.text
                                                    }
                                                    : {
                                                        borderColor: color.bg,
                                                        color: color.text
                                                    }
                                            }
                                            onClick={() => onTagFiltersChange((current) => toggleTagFilter(current, tag))}>
                                            {tag}
                                        </Badge>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                    {activeFilterCount ? (
                        <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
                            Clear filters
                        </Button>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function GridSettingsMenu({
    cardScale,
    cardSpacing,
    onCardScaleChange,
    onCardSpacingChange
}) {
    const cardScalePercent = Math.round(cardScale * 100);
    const cardSpacingPercent = Math.round(cardSpacing * 100);

    const updateCardScale = (value) => {
        const nextValue = sanitizeCardScale(value);
        onCardScaleChange(nextValue);
        void configRepository.setString('VRCX_MyAvatarsCardScale', String(nextValue));
    };

    const updateCardSpacing = (value) => {
        const nextValue = sanitizeCardSpacing(value);
        onCardSpacingChange(nextValue);
        void configRepository.setString('VRCX_MyAvatarsCardSpacing', String(nextValue));
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button className="rounded-full" size="icon-sm" variant="ghost">
                    <SettingsIcon className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60 p-3" align="end">
                <div className="grid gap-3">
                    <label className="grid gap-1.5">
                        <div className="flex items-center justify-between text-[13px] font-medium">
                            <span>Scale</span>
                            <span className="text-xs">{cardScalePercent}%</span>
                        </div>
                        <input
                            type="range"
                            min="0.4"
                            max="1.4"
                            step="0.05"
                            value={cardScale}
                            onChange={(event) => updateCardScale(event.target.value)}
                        />
                    </label>
                    <label className="grid gap-1.5">
                        <div className="flex items-center justify-between text-[13px] font-medium">
                            <span>Spacing</span>
                            <span className="text-xs">{cardSpacingPercent}%</span>
                        </div>
                        <input
                            type="range"
                            min="0.6"
                            max="2"
                            step="0.05"
                            value={cardSpacing}
                            onChange={(event) => updateCardSpacing(event.target.value)}
                        />
                    </label>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function MyAvatarGridCard({
    avatar,
    currentAvatarId,
    cardScale,
    isUpdating,
    onAction
}) {
    const isActive = avatar?.id === currentAvatarId;
    const platforms = getAvailablePlatforms(avatar?.unityPackages);
    const disabled = resolveActionDisabled(avatar, isUpdating);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border text-left hover:bg-accent ${
                        isActive ? 'ring-2 ring-primary' : 'border-border/50'
                    }`}
                    onClick={() => onAction('wear', avatar)}>
                    <div className="relative aspect-[5/2] w-full overflow-hidden bg-muted">
                        {avatar?.thumbnailImageUrl ? (
                            <img
                                src={avatar.thumbnailImageUrl}
                                alt={avatar?.name || 'Avatar'}
                                className="h-full w-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="grid h-full w-full place-items-center text-muted-foreground">
                                <ImageIcon className="size-6" />
                            </div>
                        )}
                        {platforms?.isQuest || platforms?.isIos ? (
                            <div className="absolute top-1 right-1 flex -space-x-1">
                                {platforms?.isPC ? <span className="size-2.5 rounded-full border bg-muted-foreground/70" /> : null}
                                {platforms?.isQuest ? <span className="size-2.5 rounded-full border bg-muted-foreground/50" /> : null}
                                {platforms?.isIos ? <span className="size-2.5 rounded-full border bg-muted-foreground/30" /> : null}
                            </div>
                        ) : null}
                    </div>
                    <div
                        className="min-h-0 flex flex-col gap-0.5"
                        style={{
                            padding: `${Math.round(6 * cardScale)}px ${Math.round(8 * cardScale)}px`
                        }}>
                        <span
                            className="line-clamp-2 block min-h-[2.75em] overflow-hidden leading-snug"
                            style={{
                                fontSize: `${Math.max(9, Math.round(18 * cardScale))}px`
                            }}>
                            {avatar?.name || 'Untitled avatar'}
                        </span>
                        {(avatar?.$tags || []).length ? (
                            <div
                                className="flex flex-nowrap gap-0.5 overflow-hidden"
                                style={{
                                    maxHeight: `${Math.max(14, Math.round(22 * cardScale))}px`
                                }}>
                                {avatar.$tags.map((entry) => {
                                    const color = getTagColor(entry.tag);
                                    return (
                                        <Badge
                                            key={`${avatar.id}:${entry.tag}`}
                                            variant="outline"
                                            className="shrink-0 rounded-sm px-1 py-0 leading-tight"
                                            style={{
                                                fontSize: `${Math.max(8, Math.round(14 * cardScale))}px`,
                                                borderColor: color.bg,
                                                color: color.text
                                            }}>
                                            {entry.tag}
                                        </Badge>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <AvatarActionMenuItems
                    avatar={avatar}
                    isActive={isActive}
                    disabled={disabled}
                    Item={ContextMenuItem}
                    Separator={ContextMenuSeparator}
                    onAction={onAction}
                />
            </ContextMenuContent>
        </ContextMenu>
    );
}

function resolveTagBadgeStyle(entry) {
    const color = entry?.color
        ? {
            bg: entry.color,
            text:
                typeof entry.color === 'string'
                    ? entry.color.replace(/\/ [\d.]+\)$/, ')')
                    : entry.color
        }
        : getTagColor(entry?.tag || '');
    return {
        backgroundColor: color.bg,
        color: color.text
    };
}

function isRuntimeAuthTarget(authTarget) {
    const runtimeAuth = useRuntimeStore.getState().auth;
    return (
        runtimeAuth.currentUserId === authTarget.currentUserId &&
        runtimeAuth.currentUserEndpoint === authTarget.currentEndpoint
    );
}

export function MyAvatarsPage({ embedded = false } = {}) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserSnapshot = useRuntimeStore((state) => state.auth.currentUserSnapshot);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);

    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';
    const previousAvatarSwapTime = Number(currentUserSnapshot?.$previousAvatarSwapTime) || 0;

    const persistedState = useMemo(() => readPersistedState(), []);
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const requestIdRef = useRef(0);
    const imageUploadInputRef = useRef(null);
    const imageUploadAvatarRef = useRef(null);
    const imageUploadAuthTargetRef = useRef(null);
    const gridScrollRef = useRef(null);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const tablePageSizesPreference = usePreferencesStore((state) => state.tablePageSizes);

    const [avatars, setAvatars] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [viewMode, setViewMode] = useState('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [releaseStatusFilter, setReleaseStatusFilter] = useState('all');
    const [platformFilter, setPlatformFilter] = useState('all');
    const [tagFilters, setTagFilters] = useState(() => new Set());
    const [cardScale, setCardScale] = useState(DEFAULT_CARD_SCALE);
    const [cardSpacing, setCardSpacing] = useState(DEFAULT_CARD_SPACING);
    const [pageSizes, setPageSizes] = useState(DEFAULT_PAGE_SIZES);
    const [refreshToken, setRefreshToken] = useState(0);
    const [manageTagsAvatar, setManageTagsAvatar] = useState(null);
    const [stylesAvatar, setStylesAvatar] = useState(null);
    const [imageCropRequest, setImageCropRequest] = useState(null);
    const [savingTagsAvatarId, setSavingTagsAvatarId] = useState('');
    const [updatingAvatarId, setUpdatingAvatarId] = useState('');
    const [uploadingImageAvatarId, setUploadingImageAvatarId] = useState('');
    const [sorting, setSorting] = useState(() => sanitizeSorting(persistedState.sorting));
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeColumnSizing(persistedState.columnSizing)
    );
    const [gridScrollMetrics, setGridScrollMetrics] = useState({
        scrollTop: 0,
        viewportHeight: 0,
        width: 0
    });
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolvePageSize(
            persistedState.pageSize,
            DEFAULT_PAGE_SIZES,
            DEFAULT_PAGE_SIZES[1]
        )
    }));
    const deferredSearchQuery = useDeferredValue(searchQuery);

    async function handleSaveAvatarTags({ avatarId, tags }) {
        const avatar = avatars.find((entry) => entry.id === avatarId);
        const previousTags = avatar?.$tags || [];

        setSavingTagsAvatarId(avatarId);
        try {
            const nextTags = await myAvatarRepository.updateAvatarTags({
                avatarId,
                previousTags,
                nextTags: tags
            });

            setAvatars((currentAvatars) =>
                currentAvatars.map((entry) =>
                    entry.id === avatarId
                        ? {
                            ...entry,
                            $tags: nextTags
                        }
                        : entry
                )
            );
            setManageTagsAvatar(null);
            setDetail(`Updated local tags for ${avatar?.name || avatarId}.`);
        } catch (error) {
            setDetail(error instanceof Error ? error.message : 'Failed to update avatar tags.');
        } finally {
            setSavingTagsAvatarId('');
        }
    }

    function applyAvatarUpdate(nextAvatar) {
        if (!nextAvatar?.id) {
            return;
        }

        setAvatars((currentAvatars) =>
            currentAvatars.map((entry) =>
                entry.id === nextAvatar.id
                    ? {
                        ...entry,
                        ...nextAvatar,
                        $tags: entry.$tags || [],
                        $timeSpent: entry.$timeSpent || 0
                    }
                    : entry
            )
        );
    }

    async function saveAvatarPatch(avatar, params, successMessage) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId) {
            return;
        }

        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };

        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setUpdatingAvatarId(avatarId);

        try {
            const nextAvatar = await myAvatarRepository.saveAvatar({
                avatarId,
                endpoint: currentEndpoint,
                params
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            applyAvatarUpdate(nextAvatar);
            setDetail(successMessage);
            toast.success(successMessage);
        } catch (error) {
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            const message = error instanceof Error ? error.message : 'Failed to update avatar.';
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) => (current === avatarId ? '' : current));
        }
    }

    async function renameAvatar(avatar) {
        const result = await prompt({
            title: 'Rename avatar',
            description: avatar?.name || avatar?.id || '',
            inputValue: avatar?.name || '',
            confirmText: 'Rename',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        const nextName = String(result.value || '').trim();
        if (!nextName || nextName === avatar?.name) {
            return;
        }

        await saveAvatarPatch(avatar, { name: nextName }, 'Avatar renamed.');
    }

    async function changeAvatarDescription(avatar) {
        const result = await prompt({
            title: 'Change avatar description',
            description: avatar?.name || avatar?.id || '',
            inputValue: avatar?.description || '',
            confirmText: 'Save',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        const nextDescription = String(result.value || '').trim();
        if (nextDescription === (avatar?.description || '')) {
            return;
        }

        await saveAvatarPatch(
            avatar,
            { description: nextDescription },
            'Avatar description updated.'
        );
    }

    async function wearAvatar(avatar) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId || avatarId === currentAvatarId) {
            return;
        }

        const shouldConfirm = await configRepository.getBool('showConfirmationOnSwitchAvatar', true);
        if (shouldConfirm) {
            const result = await confirm({
                title: 'Confirm',
                description: `Select avatar?\n${avatar?.name || avatarId}`,
                confirmText: 'Select',
                cancelText: 'Cancel'
            });
            if (!result.ok) {
                return;
            }
        }

        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setUpdatingAvatarId(avatarId);
        try {
            await avatarProfileRepository.selectAvatar({
                avatarId,
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setDetail(`Selected avatar ${avatar?.name || avatarId}.`);
            toast.success('Avatar selected.');
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                const message = error instanceof Error ? error.message : 'Failed to select avatar.';
                setDetail(message);
                toast.error(message);
            }
        } finally {
            setUpdatingAvatarId((current) => (current === avatarId ? '' : current));
        }
    }

    async function toggleAvatarReleaseStatus(avatar) {
        const nextReleaseStatus = avatar?.releaseStatus === 'public' ? 'private' : 'public';
        const result = await confirm({
            title:
                nextReleaseStatus === 'public'
                    ? 'Make avatar public?'
                    : 'Make avatar private?',
            description: avatar?.name || avatar?.id || '',
            confirmText: nextReleaseStatus === 'public' ? 'Make Public' : 'Make Private',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        await saveAvatarPatch(
            avatar,
            { releaseStatus: nextReleaseStatus },
            nextReleaseStatus === 'public'
                ? 'Avatar made public.'
                : 'Avatar made private.'
        );
    }

    function openAvatarContentTags(avatar) {
        openAvatarDetails(avatar);
    }

    function openAvatarStyles(avatar) {
        if (!avatar?.id) {
            return;
        }
        setStylesAvatar(avatar);
    }

    async function createAvatarImpostor(avatar) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId) {
            return;
        }

        const result = await confirm({
            title: 'Create impostor?',
            description: avatar?.name || avatarId,
            confirmText: 'Create',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        const authTarget = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };

        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setUpdatingAvatarId(avatarId);
        try {
            await myAvatarRepository.createImpostor({
                avatarId,
                endpoint: currentEndpoint
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            setDetail('Impostor queued for creation.');
            toast.success('Impostor queued for creation.');
        } catch (error) {
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Failed to create impostor.';
            setDetail(message);
            toast.error(message);
        } finally {
            setUpdatingAvatarId((current) => (current === avatarId ? '' : current));
        }
    }

    function beginAvatarImageUpload(avatar) {
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        if (!avatarId || !currentUserId) {
            return;
        }

        imageUploadAvatarRef.current = avatar;
        imageUploadAuthTargetRef.current = {
            currentUserId,
            currentEndpoint: currentEndpoint || ''
        };
        imageUploadInputRef.current?.click();
    }

    async function handleAvatarAction(action, avatar) {
        switch (action) {
            case 'details':
                openAvatarDetails(avatar);
                break;
            case 'wear':
                await wearAvatar(avatar);
                break;
            case 'manageTags':
                setManageTagsAvatar(avatar);
                break;
            case 'makePrivate':
            case 'makePublic':
                await toggleAvatarReleaseStatus(avatar);
                break;
            case 'rename':
                await renameAvatar(avatar);
                break;
            case 'changeDescription':
                await changeAvatarDescription(avatar);
                break;
            case 'changeTags':
                openAvatarContentTags(avatar);
                break;
            case 'changeStyles':
                openAvatarStyles(avatar);
                break;
            case 'changeImage':
                beginAvatarImageUpload(avatar);
                break;
            case 'createImpostor':
                await createAvatarImpostor(avatar);
                break;
        }
    }

    function showImageValidationError(validation) {
        if (validation.reason === 'too_large') {
            toast.error('Selected image is too large.');
        } else if (validation.reason === 'not_image') {
            toast.error('Selected file is not an image.');
        }
    }

    async function onAvatarImageFileChange(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }

        const avatar = imageUploadAvatarRef.current;
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        const authTarget = imageUploadAuthTargetRef.current;
        if (!avatarId || !authTarget || !isRuntimeAuthTarget(authTarget)) {
            return;
        }

        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            showImageValidationError(validation);
            return;
        }

        setImageCropRequest({
            file,
            avatar,
            authTarget
        });
    }

    async function confirmAvatarImageUpload(blob) {
        const request = imageCropRequest;
        const avatar = request?.avatar;
        const avatarId = typeof avatar?.id === 'string' ? avatar.id.trim() : '';
        const authTarget = request?.authTarget;
        if (!blob || !avatarId || !authTarget || !isRuntimeAuthTarget(authTarget)) {
            return;
        }

        setUploadingImageAvatarId(avatarId);

        try {
            const base64Body = await readFileAsBase64(blob);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            const base64File = await mediaRepository.resizeImageToFitLimits(base64Body);
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            const result = await withUploadTimeout(
                mediaRepository.uploadAvatarImageLegacy({
                    avatarId,
                    imageUrl: avatar.imageUrl || avatar.thumbnailImageUrl || '',
                    base64File,
                    blob,
                    endpoint: currentEndpoint
                })
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }

            applyAvatarUpdate(result.avatar);
            setDetail(`Avatar image updated for ${avatar?.name || avatarId}.`);
            toast.success('Avatar image updated.');
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                const message = error instanceof Error ? error.message : 'Failed to upload avatar image.';
                setDetail(message);
                toast.error(message);
            }
        } finally {
            imageUploadAvatarRef.current = null;
            imageUploadAuthTargetRef.current = null;
            setImageCropRequest(null);
            setUploadingImageAvatarId((current) => (current === avatarId ? '' : current));
        }
    }

    useEffect(() => {
        let active = true;

        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            configRepository.getInt('tablePageSize', DEFAULT_PAGE_SIZES[1]),
            configRepository.getString('MyAvatarsViewMode', 'grid'),
            configRepository.getString('VRCX_MyAvatarsCardScale', String(DEFAULT_CARD_SCALE)),
            configRepository.getString('VRCX_MyAvatarsCardSpacing', String(DEFAULT_CARD_SPACING))
        ])
            .then(([
                nextPageSizes,
                nextPageSize,
                nextViewMode,
                nextCardScale,
                nextCardSpacing
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

                setViewMode(VIEW_MODES.includes(nextViewMode) ? nextViewMode : 'grid');
                setCardScale(sanitizeCardScale(nextCardScale));
                setCardSpacing(sanitizeCardSpacing(nextCardSpacing));
            })
            .catch(() => {});

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
    }, [preferencesHydrated, tablePageSizesPreference]);

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
    }, [deferredSearchQuery, platformFilter, releaseStatusFilter, tagFilters, viewMode]);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (!currentUserId) {
            setAvatars([]);
            setLoadStatus('idle');
            setDetail('No authenticated user is available for the avatar inventory.');
            return;
        }

        setLoadStatus('running');
        setDetail('');

        myAvatarRepository
            .getMyAvatars({
                endpoint: currentEndpoint,
                currentAvatarId,
                previousAvatarSwapTime
            })
            .then((nextAvatars) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                setAvatars(Array.isArray(nextAvatars) ? nextAvatars : []);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (requestIdRef.current !== requestId) {
                    return;
                }

                setAvatars([]);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error ? error.message : 'Failed to load the avatar inventory.'
                );
            });
    }, [
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        previousAvatarSwapTime,
        refreshToken
    ]);

    const allTags = useMemo(() => {
        const tagSet = new Set();
        for (const avatar of avatars) {
            for (const entry of avatar?.$tags || []) {
                if (entry?.tag) {
                    tagSet.add(entry.tag);
                }
            }
        }
        return Array.from(tagSet).sort((left, right) => left.localeCompare(right));
    }, [avatars]);

    const filteredAvatars = useMemo(() => {
        const searchValue = deferredSearchQuery.trim().toLowerCase();

        return avatars.filter((avatar) => {
            if (releaseStatusFilter !== 'all' && avatar?.releaseStatus !== releaseStatusFilter) {
                return false;
            }

            if (!matchesPlatformFilter(avatar, platformFilter)) {
                return false;
            }

            if (tagFilters.size > 0) {
                const avatarTags = new Set((avatar?.$tags || []).map((entry) => entry.tag));
                if (![...tagFilters].some((tag) => avatarTags.has(tag))) {
                    return false;
                }
            }

            if (!searchValue) {
                return true;
            }

            return (
                String(avatar?.name || '')
                    .toLowerCase()
                    .includes(searchValue) ||
                String(avatar?.description || '')
                    .toLowerCase()
                    .includes(searchValue) ||
                (avatar?.$tags || []).some((entry) =>
                    String(entry?.tag || '')
                        .toLowerCase()
                        .includes(searchValue)
                )
            );
        });
    }, [avatars, deferredSearchQuery, platformFilter, releaseStatusFilter, tagFilters]);

    useEffect(() => {
        if (viewMode !== 'grid') {
            return undefined;
        }

        function updateGridScrollMetrics() {
            const node = gridScrollRef.current;
            if (!node) {
                return;
            }

            const nextMetrics = {
                scrollTop: node.scrollTop,
                viewportHeight: node.clientHeight,
                width: node.clientWidth
            };

            setGridScrollMetrics((current) =>
                current.scrollTop === nextMetrics.scrollTop &&
                current.viewportHeight === nextMetrics.viewportHeight &&
                current.width === nextMetrics.width
                    ? current
                    : nextMetrics
            );
        }

        const node = gridScrollRef.current;
        if (!node) {
            return undefined;
        }

        updateGridScrollMetrics();
        node.addEventListener('scroll', updateGridScrollMetrics, { passive: true });

        const observer =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(updateGridScrollMetrics)
                : null;
        observer?.observe(node);
        window.addEventListener('resize', updateGridScrollMetrics);

        return () => {
            node.removeEventListener('scroll', updateGridScrollMetrics);
            observer?.disconnect();
            window.removeEventListener('resize', updateGridScrollMetrics);
        };
    }, [filteredAvatars.length, viewMode]);

    useEffect(() => {
        if (viewMode !== 'grid') {
            return;
        }

        const node = gridScrollRef.current;
        if (node) {
            node.scrollTop = 0;
        }

        setGridScrollMetrics((current) => ({
            ...current,
            scrollTop: 0
        }));
    }, [
        cardScale,
        cardSpacing,
        deferredSearchQuery,
        filteredAvatars.length,
        platformFilter,
        releaseStatusFilter,
        tagFilters,
        viewMode
    ]);

    useEffect(() => {
        const maxPageIndex = Math.max(0, Math.ceil(filteredAvatars.length / pagination.pageSize) - 1);
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [filteredAvatars.length, pagination.pageIndex, pagination.pageSize]);

    const columns = useMemo(
        () => [
            {
                id: 'active',
                accessorFn: (row) => (row?.id === currentAvatarId ? 1 : 0),
                header: () => null,
                cell: ({ row }) =>
                    row.original?.id === currentAvatarId ? (
                        <CheckIcon className="size-4 text-primary" />
                    ) : (
                        <span className="block size-4" />
                    )
            },
            {
                id: 'thumbnail',
                accessorFn: (row) => row?.thumbnailImageUrl || '',
                header: () => null,
                enableSorting: false,
                cell: ({ row }) =>
                    row.original?.thumbnailImageUrl ? (
                        <button
                            type="button"
                            className="block"
                            onClick={() => openAvatarDetails(row.original)}>
                            <img
                                src={row.original.thumbnailImageUrl}
                                alt={row.original?.name || 'Avatar thumbnail'}
                                className="h-10 w-16 rounded-sm object-cover"
                                loading="lazy"
                            />
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="flex h-10 w-16 items-center justify-center rounded-sm border bg-muted text-muted-foreground"
                            onClick={() => openAvatarDetails(row.original)}>
                            <ImageIcon className="size-4" />
                        </button>
                    )
            },
            {
                id: 'name',
                accessorFn: (row) => row?.name || '',
                meta: { label: t('dialog.avatar.info.name') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.name')} />,
                cell: ({ row }) => (
                    <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => openAvatarDetails(row.original)}>
                        {row.original?.name || ''}
                    </button>
                )
            },
            {
                id: 'customTags',
                accessorFn: (row) => (row?.$tags || []).map((entry) => entry.tag).join(', '),
                meta: { label: t('dialog.avatar.info.tags') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.tags')} />,
                cell: ({ row }) =>
                    (row.original?.$tags || []).length ? (
                        <div className="flex flex-wrap gap-1">
                            {row.original.$tags.map((entry) => (
                                <Badge
                                    key={`${row.original.id}:${entry.tag}`}
                                    variant="secondary"
                                    style={resolveTagBadgeStyle(entry)}>
                                    {entry.tag}
                                </Badge>
                            ))}
                        </div>
                    ) : (
                        null
                    )
            },
            {
                id: 'platforms',
                accessorFn: (row) => (row?.unityPackages?.length ? 1 : 0),
                meta: { label: t('dialog.avatar.info.platform') },
                header: () => (
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('dialog.avatar.info.platform')}
                    </span>
                ),
                enableSorting: false,
                cell: ({ row }) => <PlatformBadges unityPackages={row.original?.unityPackages} />
            },
            {
                id: 'visibility',
                accessorFn: (row) => row?.releaseStatus || '',
                meta: { label: t('dialog.avatar.info.visibility') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.visibility')} />,
                cell: ({ row }) => (
                    <Badge variant="outline">
                        {row.original?.releaseStatus === 'public'
                            ? t('dialog.avatar.tags.public')
                            : t('dialog.avatar.tags.private')}
                    </Badge>
                )
            },
            {
                id: 'timeSpent',
                accessorFn: (row) => Number(row?.$timeSpent) || 0,
                meta: { label: t('dialog.avatar.info.time_spent') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.time_spent')} descFirst />,
                cell: ({ row }) => (
                    <span>{row.original?.$timeSpent ? timeToText(row.original.$timeSpent) : '-'}</span>
                )
            },
            {
                id: 'version',
                accessorFn: (row) => Number(row?.version) || 0,
                meta: { label: t('dialog.avatar.info.version') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.version')} descFirst />,
                cell: ({ row }) => <span>{row.original?.version ?? '-'}</span>
            },
            {
                id: 'pcPerf',
                accessorFn: (row) => getAvatarPlatformInfo(row)?.pc?.performanceRating || '',
                meta: { label: t('dialog.avatar.info.pc_performance') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.pc_performance')} />,
                cell: ({ row }) => {
                    const platformInfo = getAvatarPlatformInfo(row.original);
                    return <span>{resolvePerformanceLabel(platformInfo?.pc?.performanceRating)}</span>;
                }
            },
            {
                id: 'androidPerf',
                accessorFn: (row) =>
                    getAvatarPlatformInfo(row)?.android?.performanceRating || '',
                meta: { label: t('dialog.avatar.info.android_performance') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.android_performance')} />,
                cell: ({ row }) => {
                    const platformInfo = getAvatarPlatformInfo(row.original);
                    return <span>{resolvePerformanceLabel(platformInfo?.android?.performanceRating)}</span>;
                }
            },
            {
                id: 'iosPerf',
                accessorFn: (row) => getAvatarPlatformInfo(row)?.ios?.performanceRating || '',
                meta: { label: t('dialog.avatar.info.ios_performance') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.ios_performance')} />,
                cell: ({ row }) => {
                    const platformInfo = getAvatarPlatformInfo(row.original);
                    return <span>{resolvePerformanceLabel(platformInfo?.ios?.performanceRating)}</span>;
                }
            },
            {
                id: 'updated_at',
                accessorFn: (row) => row?.updated_at || '',
                meta: { label: t('dialog.avatar.info.last_updated') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.last_updated')} descFirst />,
                cell: ({ row }) => (
                    <span>{row.original?.updated_at ? formatDateFilter(row.original.updated_at, 'long') : '-'}</span>
                )
            },
            {
                id: 'created_at',
                accessorFn: (row) => row?.created_at || '',
                meta: { label: t('dialog.avatar.info.created_at') },
                header: ({ column }) => <SortButton column={column} label={t('dialog.avatar.info.created_at')} descFirst />,
                cell: ({ row }) => (
                    <span>{row.original?.created_at ? formatDateFilter(row.original.created_at, 'long') : '-'}</span>
                )
            },
            {
                id: 'actions',
                enableSorting: false,
                meta: { label: t('table.import.action') },
                header: () => null,
                cell: ({ row }) => {
                    const isUpdating =
                        updatingAvatarId === row.original?.id ||
                        savingTagsAvatarId === row.original?.id ||
                        uploadingImageAvatarId === row.original?.id;
                    return (
                        <AvatarActionsDropdown
                            avatar={row.original}
                            isActive={row.original?.id === currentAvatarId}
                            isUpdating={isUpdating}
                            onAction={(action, avatar) => void handleAvatarAction(action, avatar)}
                        />
                    );
                }
            }
        ],
        [
            currentAvatarId,
            handleAvatarAction,
            savingTagsAvatarId,
            t,
            updatingAvatarId,
            uploadingImageAvatarId
        ]
    );

    const table = useReactTable({
        data: filteredAvatars,
        columns,
        state: {
            sorting,
            pagination,
            columnVisibility,
            columnOrder,
            columnSizing
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
    const gridGap = Math.round(12 * cardSpacing);
    const gridMinWidth = Math.round(Math.max(200, 320 * cardScale));
    const gridColumnCount = Math.max(
        1,
        Math.floor((gridScrollMetrics.width + gridGap) / (gridMinWidth + gridGap)) || 1
    );
    const gridColumnWidth =
        gridScrollMetrics.width > 0
            ? Math.max(
                gridMinWidth,
                (gridScrollMetrics.width - gridGap * Math.max(0, gridColumnCount - 1)) / gridColumnCount
            )
            : gridMinWidth;
    const gridRowHeight = Math.ceil(
        Math.max(180, gridColumnWidth * 0.4 + Math.max(78, 116 * cardScale) + gridGap)
    );
    const gridRows = useMemo(() => {
        const rows = [];
        for (let index = 0; index < filteredAvatars.length; index += gridColumnCount) {
            rows.push({
                key: `grid-row:${index}`,
                avatars: filteredAvatars.slice(index, index + gridColumnCount),
                top: rows.length * gridRowHeight,
                height: gridRowHeight
            });
        }
        return rows;
    }, [filteredAvatars, gridColumnCount, gridRowHeight]);
    const gridTotalHeight = gridRows.length * gridRowHeight;
    const visibleGridRows = useMemo(() => {
        const overscan = Math.max(480, gridScrollMetrics.viewportHeight);
        const start = Math.max(0, gridScrollMetrics.scrollTop - overscan);
        const end = gridScrollMetrics.scrollTop + gridScrollMetrics.viewportHeight + overscan;
        return gridRows.filter((row) => row.top + row.height >= start && row.top <= end);
    }, [gridRows, gridScrollMetrics.scrollTop, gridScrollMetrics.viewportHeight]);
    const isLoading = loadStatus === 'running' && avatars.length === 0;
    const isError = loadStatus === 'error' && avatars.length === 0;
    const hasRows = filteredAvatars.length > 0;
    const activeFilterCount =
        (releaseStatusFilter !== 'all' ? 1 : 0) +
        (platformFilter !== 'all' ? 1 : 0) +
        tagFilters.size;

    return (
        <div
            className={
                embedded
                    ? 'flex h-full min-h-0 flex-col p-3'
                    : 'x-container flex h-full min-h-0 flex-col overflow-hidden p-3'
            }>
            <input
                ref={imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => void onAvatarImageFileChange(event)}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 px-0.5 pt-1.5">
                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            size="icon-sm"
                            variant={viewMode === 'grid' ? 'default' : 'outline'}
                            onClick={() => {
                                setViewMode('grid');
                                void configRepository.setString('MyAvatarsViewMode', 'grid');
                            }}>
                            <LayoutGridIcon className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant={viewMode === 'table' ? 'default' : 'outline'}
                            onClick={() => {
                                setViewMode('table');
                                void configRepository.setString('MyAvatarsViewMode', 'table');
                            }}>
                            <ListIcon className="size-4" />
                        </Button>
                    </div>

                    <MyAvatarFilterPopover
                        activeFilterCount={activeFilterCount}
                        allTags={allTags}
                        releaseStatusFilter={releaseStatusFilter}
                        platformFilter={platformFilter}
                        tagFilters={tagFilters}
                        onReleaseStatusChange={setReleaseStatusFilter}
                        onPlatformChange={setPlatformFilter}
                        onTagFiltersChange={setTagFilters}
                        onClearFilters={() => {
                            setReleaseStatusFilter('all');
                            setPlatformFilter('all');
                            setTagFilters(new Set());
                        }}
                    />

                    <div className="flex-1" />

                    {loadStatus === 'running' ? (
                        <span className="text-sm text-muted-foreground">Loading</span>
                    ) : null}
                    <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search"
                        className="h-8 w-80"
                    />
                    {viewMode === 'grid' ? (
                        <GridSettingsMenu
                            cardScale={cardScale}
                            cardSpacing={cardSpacing}
                            onCardScaleChange={setCardScale}
                            onCardSpacingChange={setCardSpacing}
                        />
                    ) : null}
                    {viewMode === 'table' ? <TableColumnVisibilityMenu table={table} /> : null}
                    {viewMode === 'table' ? (
                        <Select
                            value={String(pagination.pageSize)}
                            onValueChange={(value) => {
                                const nextPageSize = resolvePageSize(value, pageSizes, pagination.pageSize);
                                setPagination({
                                    pageIndex: 0,
                                    pageSize: nextPageSize
                                });
                            }}>
                            <SelectTrigger className="h-8 w-24">
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
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={!currentUserId || loadStatus === 'running'}
                        onClick={() => setRefreshToken((value) => value + 1)}>
                        <RefreshCwIcon className={loadStatus === 'running' ? 'size-4 animate-spin' : 'size-4'} />
                    </Button>
                </div>

                {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}

                    {isLoading ? (
                        <div className="flex min-h-72 flex-1 items-center justify-center rounded-xl border border-dashed bg-muted/20">
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <LoaderCircleIcon className="size-5 animate-spin" />
                                Loading the avatar inventory
                            </div>
                        </div>
                    ) : isError ? (
                        <MyAvatarsEmptyState
                            title="Avatar inventory failed to load"
                            description={detail || 'The avatar request did not complete.'}
                        />
                    ) : hasRows ? (
                        viewMode === 'table' ? (
                            <>
                                <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                                    <div className="h-full overflow-auto">
                                        <Table className="vrcx-data-table table-fixed">
                                            <TableHeader>
                                                {table.getHeaderGroups().map((headerGroup) => (
                                                    <TableRow key={headerGroup.id}>
                                                        {headerGroup.headers.map((header) => (
                                                            <ResizableTableHead key={header.id} header={header} />
                                                        ))}
                                                    </TableRow>
                                                ))}
                                            </TableHeader>
                                            <TableBody>
                                            {table.getRowModel().rows.map((row) => (
                                                <ContextMenu key={row.original?.id || row.id}>
                                                    <ContextMenuTrigger asChild>
                                                        <TableRow
                                                            className={
                                                                row.original?.id === currentAvatarId
                                                                    ? 'cursor-pointer bg-primary/10'
                                                                    : 'cursor-pointer'
                                                            }
                                                            onClick={() => openAvatarDetails(row.original)}>
                                                            {row.getVisibleCells().map((cell) => (
                                                                <ResizableTableCell key={cell.id} cell={cell} />
                                                            ))}
                                                        </TableRow>
                                                    </ContextMenuTrigger>
                                                    <ContextMenuContent>
                                                        <AvatarActionMenuItems
                                                            avatar={row.original}
                                                            isActive={row.original?.id === currentAvatarId}
                                                            disabled={
                                                                updatingAvatarId === row.original?.id ||
                                                                savingTagsAvatarId === row.original?.id ||
                                                                uploadingImageAvatarId === row.original?.id
                                                            }
                                                            Item={ContextMenuItem}
                                                            Separator={ContextMenuSeparator}
                                                            onAction={(action, avatar) => void handleAvatarAction(action, avatar)}
                                                        />
                                                    </ContextMenuContent>
                                                </ContextMenu>
                                            ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div className="text-sm text-muted-foreground">
                                        Showing{' '}
                                        <span className="font-medium text-foreground">
                                            {table.getRowModel().rows.length}
                                        </span>{' '}
                                        of{' '}
                                        <span className="font-medium text-foreground">
                                            {filteredAvatars.length}
                                        </span>{' '}
                                        avatar{filteredAvatars.length === 1 ? '' : 's'}
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
                            </>
                        ) : (
                            <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-auto py-2">
                                <div
                                    className="relative p-1"
                                    style={{
                                        height: `${gridTotalHeight}px`
                                    }}>
                                    {visibleGridRows.map((row) => (
                                        <div
                                            key={row.key}
                                            className="absolute right-1 left-1 grid overflow-hidden"
                                            style={{
                                                height: `${row.height}px`,
                                                gap: `${gridGap}px`,
                                                gridTemplateColumns: `repeat(${gridColumnCount}, minmax(${gridMinWidth}px, 1fr))`,
                                                transform: `translateY(${row.top}px)`
                                            }}>
                                            {row.avatars.map((avatar) => (
                                                <MyAvatarGridCard
                                                    key={avatar.id}
                                                    avatar={avatar}
                                                    currentAvatarId={currentAvatarId}
                                                    cardScale={cardScale}
                                                    isUpdating={
                                                        savingTagsAvatarId === avatar.id ||
                                                        updatingAvatarId === avatar.id ||
                                                        uploadingImageAvatarId === avatar.id
                                                    }
                                                    onAction={(action, nextAvatar) => void handleAvatarAction(action, nextAvatar)}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    ) : (
                        <MyAvatarsEmptyState
                            title="No avatars match the current filters"
                            description="Broaden the filters or search query to see more avatars."
                        />
                    )}
            </div>
            <ImageCropDialog
                open={Boolean(imageCropRequest)}
                file={imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title="Change avatar image"
                onOpenChange={(open) => {
                    if (!open) {
                        setImageCropRequest(null);
                        imageUploadAvatarRef.current = null;
                        imageUploadAuthTargetRef.current = null;
                    }
                }}
                onConfirm={(blob) => confirmAvatarImageUpload(blob)}
            />
            <ManageAvatarTagsDialog
                open={Boolean(manageTagsAvatar)}
                avatar={manageTagsAvatar}
                saving={Boolean(savingTagsAvatarId)}
                onOpenChange={(open) => {
                    if (!open && !savingTagsAvatarId) {
                        setManageTagsAvatar(null);
                    }
                }}
                onSave={handleSaveAvatarTags}
            />
            <AvatarStylesDialog
                open={Boolean(stylesAvatar)}
                avatar={stylesAvatar}
                currentUserId={currentUserId}
                endpoint={currentEndpoint}
                onOpenChange={(open) => {
                    if (!open) {
                        setStylesAvatar(null);
                    }
                }}
                onSaved={(nextAvatar) => {
                    applyAvatarUpdate(nextAvatar);
                    setDetail('Avatar styles updated.');
                }}
            />
        </div>
    );
}
