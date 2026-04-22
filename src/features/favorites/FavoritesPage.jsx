import {
    ArrowUpDownIcon,
    CopyIcon,
    GlobeIcon,
    ImageIcon,
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { userImage } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import {
    avatarProfileRepository,
    avatarLocalRepository,
    configRepository,
    localFavoritesRepository,
    notificationRepository,
    vrchatSearchRepository,
    vrchatFavoriteRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { bootstrapFavorites } from '@/services/favoriteBootstrapService.js';
import { openFavoriteImportDialog } from '@/services/favoriteImportService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { setBoolConfigPreference } from '@/services/preferencesService.js';
import { checkCanInvite, checkCanInviteSelf } from '@/shared/utils/invite.js';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    buildFavoriteExportCsv,
    FAVORITES_EXPORT_ALL_VALUE as EXPORT_ALL_VALUE,
    FAVORITES_EXPORT_NONE_VALUE as EXPORT_NONE_VALUE,
    getFavoriteExportFieldOptions
} from './favoritesExport.js';
import {
    favoriteGroupType,
    normalizeFavoriteEntityId as normalizeEntityId,
    normalizeFavoriteSearchValue as normalizeSearchValue,
    resolveCurrentInviteLocation,
    shrinkFavoriteImage as shrinkImage,
    sortFavoriteItems as sortItems
} from './favoritesItems.js';
import {
    clearFavoriteRemoteDetailsCache,
    useFavoriteRemoteDetails
} from './useFavoriteRemoteDetails.js';
import { appI18n } from '@/services/i18nService.js';

const VISIBILITY_OPTIONS = ['public', 'friends', 'private'];
const EMPTY_ITEMS = Object.freeze([]);

function useStableEvent(handler) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    return useCallback((...args) => handlerRef.current?.(...args), []);
}
const SPLITTER_CONFIG_KEYS = {
    friend: 'VRCX_FavoritesFriendSplitter',
    world: 'VRCX_FavoritesWorldSplitter',
    avatar: 'VRCX_FavoritesAvatarSplitter'
};
const SPLITTER_DEFAULT_SIZE_PX = 260;
const SPLITTER_MIN_SIZE_PX = 0;
const SPLITTER_CONTENT_MIN_SIZE_PX = 320;
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
function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function normalizeSplitterSizePx(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return SPLITTER_DEFAULT_SIZE_PX;
    }
    return Math.max(SPLITTER_MIN_SIZE_PX, Math.round(parsed));
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
    const [selectedFields, setSelectedFields] = useState(() =>
        fieldOptions.map((option) => option.value)
    );
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
            toast.success(appI18n.t('view.favorite.generated.copied_favorite_export_data'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_copy_favorite_export_data')
            );
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{appI18n.t('view.favorite.generated.export_favorite')} {kind}{appI18n.t('common.time_units.s')}</DialogTitle>
                    <DialogDescription>
                        {appI18n.t('view.favorite.generated.review_the_csv_content_before_copying_it_to_the_clipboard')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup
                    data-slot="checkbox-group"
                    className="flex flex-row flex-wrap gap-3"
                >
                    {fieldOptions.map((option) => (
                        <Field
                            key={option.value}
                            orientation="horizontal"
                            className="w-auto items-center"
                        >
                            <Checkbox
                                id={`favorite-export-field-${kind}-${option.value}`}
                                checked={selectedFields.includes(option.value)}
                                onCheckedChange={(checked) =>
                                    toggleField(option.value, Boolean(checked))
                                }
                            />
                            <FieldLabel
                                htmlFor={`favorite-export-field-${kind}-${option.value}`}
                            >
                                {option.label}
                            </FieldLabel>
                        </Field>
                    ))}
                </FieldGroup>
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={remoteGroupKey}
                        onValueChange={setRemoteGroupKey}
                    >
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue placeholder={appI18n.t('view.favorite.generated.vrchat_group')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={EXPORT_ALL_VALUE}>
                                    {appI18n.t('view.favorite.generated.all_vrchat_favorites')}
                                </SelectItem>
                                {remoteGroups.map((group) => (
                                    <SelectItem
                                        key={group.key}
                                        value={group.key}
                                    >
                                        {group.label} (
                                        {group.capacity
                                            ? `${group.count}/${group.capacity}`
                                            : group.count}
                                        )
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Select
                        value={localGroupKey}
                        onValueChange={setLocalGroupKey}
                    >
                        <SelectTrigger size="sm" className="min-w-52">
                            <SelectValue placeholder={appI18n.t('view.favorite.generated.local_group')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={EXPORT_NONE_VALUE}>
                                    {appI18n.t('view.favorite.generated.no_local_group')}
                                </SelectItem>
                                {localGroups.map((group) => (
                                    <SelectItem
                                        key={group.key}
                                        value={group.key}
                                    >
                                        {group.label} ({group.count})
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <span className="text-muted-foreground text-sm">
                        {items.length} {appI18n.t('view.favorite.generated.item_s')}
                    </span>
                </div>
                <Textarea
                    readOnly
                    rows={16}
                    value={content}
                    className="min-h-80 resize-none font-mono text-xs"
                    onClick={(event) => event.currentTarget.select()}
                />
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {appI18n.t('common.actions.close')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!items.length || !selectedFields.length}
                        onClick={() => void copyExportContent()}
                    >
                        {appI18n.t('common.actions.copy')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
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
                <SelectTrigger size="sm" className="min-w-48">
                    <span className="flex items-center gap-2">
                        <ArrowUpDownIcon className="size-4" />
                        <SelectValue placeholder={appI18n.t('view.favorite.generated.sort_favorites')} />
                    </span>
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value="name">{appI18n.t('view.search.avatar.sort_name')}</SelectItem>
                        <SelectItem value="date">{appI18n.t('view.favorite.generated.sort_by_date')}</SelectItem>
                        {kind === 'world' ? (
                            <SelectItem value="players">
                                {appI18n.t('view.favorite.generated.sort_by_players')}
                            </SelectItem>
                        ) : null}
                    </SelectGroup>
                </SelectContent>
            </Select>

            <div className="flex min-w-72 flex-1 items-center gap-2">
                <InputGroup className="flex-1">
                    <InputGroupAddon>
                        <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={searchQuery}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={searchPlaceholder}
                        className="text-sm"
                    />
                    {kind === 'world' ? (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton
                                type="button"
                                variant={
                                    searchMode === 'name' ? 'default' : 'ghost'
                                }
                                onClick={() => onSearchModeChange('name')}
                            >
                                {appI18n.t('view.favorite.generated.name')}
                            </InputGroupButton>
                            <InputGroupButton
                                type="button"
                                variant={
                                    searchMode === 'tag' ? 'default' : 'ghost'
                                }
                                onClick={() => onSearchModeChange('tag')}
                            >
                                {appI18n.t('view.favorite.worlds.search_mode_tag')}
                            </InputGroupButton>
                        </InputGroupAddon>
                    ) : searchQuery ? (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton
                                type="button"
                                size="icon-xs"
                                aria-label={"Clear search"}
                                onClick={() => onSearchChange('')}
                            >
                                <XIcon data-icon="icon" />
                            </InputGroupButton>
                        </InputGroupAddon>
                    ) : null}
                </InputGroup>

                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={"Refresh favorites"}
                    disabled={refreshing}
                    onClick={onRefresh}
                >
                    {refreshing ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RefreshCwIcon data-icon="inline-start" />
                    )}
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full"
                            aria-label={"Favorite options"}
                        >
                            <EllipsisIcon data-icon="inline-start" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <FieldGroup
                            className="gap-3 px-3 py-2"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <Field>
                                <div className="flex items-center justify-between text-sm font-semibold">
                                    <FieldLabel>{appI18n.t('view.friends_locations.scale')}</FieldLabel>
                                    <span className="text-muted-foreground text-xs">
                                        {cardScalePercent}%
                                    </span>
                                </div>
                                <Slider
                                    min={CARD_SCALE_SLIDER.min}
                                    max={CARD_SCALE_SLIDER.max}
                                    step={CARD_SCALE_SLIDER.step}
                                    value={[cardScale]}
                                    onValueChange={(value) =>
                                        onCardScaleChange(value[0])
                                    }
                                />
                            </Field>
                            <Field>
                                <div className="flex items-center justify-between text-sm font-semibold">
                                    <FieldLabel>{appI18n.t('view.friends_locations.spacing')}</FieldLabel>
                                    <span className="text-muted-foreground text-xs">
                                        {cardSpacingPercent}%
                                    </span>
                                </div>
                                <Slider
                                    min={CARD_SPACING_SLIDER.min}
                                    max={CARD_SPACING_SLIDER.max}
                                    step={CARD_SPACING_SLIDER.step}
                                    value={[cardSpacing]}
                                    onValueChange={(value) =>
                                        onCardSpacingChange(value[0])
                                    }
                                />
                            </Field>
                        </FieldGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={onImport}>
                                <UploadIcon data-icon="inline-start" />
                                {appI18n.t('view.favorite.import')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={onExport}>
                                <DownloadIcon data-icon="inline-start" />
                                {appI18n.t('view.favorite.generated.export')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

function FavoritesEmptyState({ title, description }) {
    return (
        <div className="flex h-full min-h-60 items-center justify-center p-6 text-center">
            <div className="flex max-w-sm flex-col gap-2">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-muted-foreground text-sm">
                    {description}
                </div>
            </div>
        </div>
    );
}

function FavoritesLoadingState({ title }) {
    return (
        <div className="flex h-full min-h-60 items-center justify-center">
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
                <Spinner />
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
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="rounded-full"
                        aria-label={"History group options"}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <EllipsisIcon data-icon="inline-start" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-44"
                >
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onHistoryClear(group)}
                        >
                            {appI18n.t('common.actions.clear')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    if (group.source === 'remote') {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="rounded-full"
                        aria-label={"Remote group options"}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <MoreHorizontalIcon data-icon="inline-start" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-52"
                >
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onSelect={() => onRemoteRename(group)}
                        >
                            {appI18n.t('view.favorite.generated.rename')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            {appI18n.t('view.favorite.generated.visibility')}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-40">
                            <DropdownMenuGroup>
                                {VISIBILITY_OPTIONS.map((visibility) => (
                                    <DropdownMenuCheckboxItem
                                        key={visibility}
                                        checked={
                                            group.visibility === visibility
                                        }
                                        onSelect={() =>
                                            onRemoteVisibility(
                                                group,
                                                visibility
                                            )
                                        }
                                    >
                                        {visibility}
                                    </DropdownMenuCheckboxItem>
                                ))}
                            </DropdownMenuGroup>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onRemoteClear(group)}
                        >
                            {appI18n.t('common.actions.clear')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={"Local group options"}
                    onClick={(event) => event.stopPropagation()}
                >
                    <EllipsisIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => onLocalRename(group)}>
                        {appI18n.t('view.favorite.generated.rename')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onLocalDelete(group)}
                    >
                        {appI18n.t('common.actions.delete')}
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

const GroupRailSection = memo(function GroupRailSection({
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
                        aria-label={`Refresh ${title}`}
                        disabled={loading}
                        onClick={onRefresh}
                    >
                        {loading ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <RefreshCcwIcon data-icon="inline-start" />
                        )}
                    </Button>
                ) : null}
            </div>
            <div className="flex flex-col gap-2">
                {loading && !groups.length ? (
                    Array.from({ length: 5 }, (_, index) => (
                        <div
                            key={`group-placeholder-${index}`}
                            className="border-border pointer-events-none flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm opacity-70"
                        >
                            <div className="min-w-0">
                                <div className="truncate font-semibold">
                                    {appI18n.t('view.favorite.generated.group')} {index + 1}
                                </div>
                                <div className="bg-muted mt-1 h-3 w-14 rounded" />
                            </div>
                        </div>
                    ))
                ) : groups.length ? (
                    groups.map((group) => {
                        const isActive =
                            selectedSource === group.source &&
                            selectedGroupKey === group.key;
                        return (
                            <div
                                key={`${group.source}:${group.key}`}
                                className={cn(
                                    'hover:bg-muted flex w-full items-start justify-between rounded-lg border transition-colors',
                                    isActive
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border'
                                )}
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto min-w-0 flex-1 justify-start rounded-lg px-3 py-2 text-left whitespace-normal"
                                    onClick={() => onSelect(group)}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate font-semibold">
                                            {group.label}
                                        </span>
                                        <span className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs font-normal">
                                            {group.visibility ? (
                                                <span>{group.visibility}</span>
                                            ) : null}
                                            {group.capacity ? (
                                                <span>
                                                    {group.count}/
                                                    {group.capacity}
                                                </span>
                                            ) : (
                                                <span>{group.count}</span>
                                            )}
                                        </span>
                                    </span>
                                </Button>
                                <div className="shrink-0 py-1 pr-1">
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
                            </div>
                        );
                    })
                ) : (
                    <div className="text-muted-foreground py-3 text-center text-xs">
                        {appI18n.t('common.no_data')}
                    </div>
                )}
                {showNewGroup && !creating ? (
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full border-dashed"
                        disabled={loading}
                        onClick={onStartCreate}
                    >
                        <PlusIcon data-icon="inline-start" />
                        <span>{appI18n.t('view.favorite.generated.new_group')}</span>
                    </Button>
                ) : null}
                {showNewGroup && creating ? (
                    <Input
                        value={newGroupName}
                        autoFocus
                        className="h-8 text-sm"
                        disabled={loading}
                        placeholder={appI18n.t('view.favorite.generated.new_group')}
                        onChange={(event) =>
                            onNewGroupNameChange(event.target.value)
                        }
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
});

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
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5 pl-0.5 text-base font-semibold">
                    <span className="truncate">{title}</span>
                    {subtitle ? (
                        <small className="text-muted-foreground truncate text-xs font-normal">
                            {subtitle}
                        </small>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm">
                    <span>{appI18n.t('view.favorite.generated.edit_mode')}</span>
                    <Switch
                        checked={editMode}
                        disabled={editModeDisabled}
                        onCheckedChange={onEditModeChange}
                    />
                </div>
            </div>
            <div className="flex min-w-0 items-center justify-end">
                {editModeVisible ? (
                    <div className="mb-3 flex min-w-0 flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onToggleSelectAll}
                        >
                            {isAllSelected ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={!hasSelection}
                            onClick={onClearSelection}
                        >
                            {appI18n.t('common.actions.clear')}
                        </Button>
                        {showCopyButton ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!hasSelection}
                                onClick={onCopySelection}
                            >
                                <CopyIcon data-icon="inline-start" />
                                {appI18n.t('common.actions.copy')}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!hasSelection}
                            onClick={onBulkRemove}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {appI18n.t('view.favorite.bulk_unfavorite')}
                        </Button>
                    </div>
                ) : null}
            </div>
        </>
    );
}

const FavoriteCard = memo(function FavoriteCard({
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
    const Icon =
        item.kind === 'friend'
            ? UserIcon
            : item.kind === 'world'
              ? GlobeIcon
              : ImageIcon;
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
    const canRemoveLocal =
        item.source === 'local' && typeof onRemoveLocal === 'function';
    const canRemoveRemote =
        item.source === 'remote' && typeof onRemoveRemote === 'function';
    const friendActionLocation =
        item.kind === 'friend' ? resolvePresenceLocation(item.seedData) : '';
    const parsedFriendLocation = friendActionLocation
        ? parseLocation(friendActionLocation)
        : {};
    const canUseFriendLocation = Boolean(
        parsedFriendLocation.isRealInstance &&
        parsedFriendLocation.worldId &&
        parsedFriendLocation.instanceId
    );
    const isCurrentUser = Boolean(
        item.id && item.id === normalizeEntityId(currentUserId)
    );
    const isFriendOnline = Boolean(
        item.seedData?.state === 'online' ||
        item.seedData?.stateBucket === 'online' ||
        item.seedData?.status === 'active'
    );
    const canSelectAvatar = Boolean(
        item.kind === 'avatar' &&
        item.id &&
        item.id !== currentAvatarId &&
        onAvatarSelect
    );
    const hasCardActions = Boolean(
        canRemoveLocal ||
        canRemoveRemote ||
        canSelectAvatar ||
        item.kind === 'friend' ||
        item.kind === 'world'
    );
    const friendLocation =
        item.kind === 'friend'
            ? resolvePresenceLocation(item.seedData || item)
            : '';
    const friendShowsLocation = Boolean(
        friendLocation && friendLocation !== 'offline'
    );
    const cardPaddingY = Math.max(4, Math.round(8 * cardScale * cardSpacing));
    const cardPaddingX = Math.max(4, Math.round(10 * cardScale * cardSpacing));
    const cardGap = Math.max(4, Math.round(8 * cardSpacing));
    const mediaSize = Math.max(28, Math.round(48 * cardScale));
    const openCard = () => openHandler?.();
    const handleCardKeyDown = (event) => {
        if (!openHandler || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        openHandler();
    };

    return (
        <div
            className="hover:bg-muted flex min-w-56 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors"
            style={{
                gap: `${cardGap}px`,
                padding: `${cardPaddingY}px ${cardPaddingX}px`
            }}
            role={openHandler ? 'button' : undefined}
            tabIndex={openHandler ? 0 : undefined}
            aria-label={
                openHandler
                    ? `Open ${item.title || 'favorite item'}`
                    : undefined
            }
            onKeyDown={handleCardKeyDown}
            onClick={openHandler ? openCard : undefined}
        >
            <div
                className={cn(
                    'bg-muted flex size-12 shrink-0 items-center justify-center overflow-hidden',
                    item.kind === 'friend' ? 'rounded-full' : 'rounded-sm'
                )}
                style={{
                    width: `${mediaSize}px`,
                    height: `${mediaSize}px`
                }}
            >
                {item.imageUrl ? (
                    <img
                        src={item.imageUrl}
                        alt={item.title}
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : item.kind === 'friend' ? (
                    <UsersIcon className="text-muted-foreground size-4" />
                ) : (
                    <Icon className="text-muted-foreground size-4" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span
                        className="truncate font-medium"
                        style={
                            item.titleColor
                                ? { color: item.titleColor }
                                : undefined
                        }
                    >
                        {item.title}
                    </span>
                    {item.isUnavailable ? (
                        <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                    ) : null}
                    {item.isPrivate ? (
                        <LockIcon className="text-muted-foreground size-4 shrink-0" />
                    ) : null}
                </div>
                {friendShowsLocation ? (
                    <div
                        className="text-muted-foreground truncate text-xs"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Location
                            location={friendLocation}
                            traveling={item.travelingToLocation}
                            hint={
                                item.seedData?.worldName ||
                                item.seedData?.travelingToWorld ||
                                ''
                            }
                            grouphint={item.seedData?.groupName || ''}
                            link={false}
                            asButton={false}
                            disableTooltip
                        />
                    </div>
                ) : (
                    <div className="text-muted-foreground truncate text-xs">
                        {item.subtitle}
                    </div>
                )}
                {showGroupLabel ? (
                    <div className="text-muted-foreground truncate text-xs">
                        {item.source === 'remote' ? 'VRChat' : 'Local'} /{' '}
                        {item.groupLabel}
                    </div>
                ) : null}
            </div>
            {editMode ? (
                <Checkbox
                    aria-label={`Select ${item.title || 'favorite item'}`}
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) =>
                        onToggleSelect?.(item.key, Boolean(checked))
                    }
                />
            ) : hasCardActions ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full"
                            aria-label={"Favorite item options"}
                            disabled={removing}
                            onClick={(event) => event.stopPropagation()}
                        >
                            {removing ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <MoreHorizontalIcon data-icon="inline-start" />
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => openHandler?.()}>
                                {appI18n.t('view.favorite.generated.view_details')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {item.kind === 'friend' ? (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !isFriendOnline ||
                                            !onFriendRequestInvite
                                        }
                                        onSelect={() =>
                                            onFriendRequestInvite?.(item)
                                        }
                                    >
                                        {appI18n.t('view.favorite.generated.request_invite')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canSendInvite ||
                                            !onFriendInvite
                                        }
                                        onSelect={() => onFriendInvite?.(item)}
                                    >
                                        {appI18n.t('view.favorite.generated.send_invite')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            isCurrentUser ||
                                            !canBoop ||
                                            !onFriendBoop
                                        }
                                        onSelect={() => onFriendBoop?.(item)}
                                    >
                                        {appI18n.t('view.favorite.generated.send_boop')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        disabled={
                                            !canUseFriendLocation ||
                                            !onFriendLaunch
                                        }
                                        onSelect={() => onFriendLaunch?.(item)}
                                    >
                                        {appI18n.t('view.favorite.generated.launch_in_vrchat')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        disabled={
                                            !canUseFriendLocation ||
                                            !onFriendSelfInvite
                                        }
                                        onSelect={() =>
                                            onFriendSelfInvite?.(item)
                                        }
                                    >
                                        {appI18n.t('view.favorite.generated.self_invite')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                        {item.kind === 'world' ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    disabled={!onWorldNewInstance}
                                    onSelect={() => onWorldNewInstance?.(item)}
                                >
                                    {appI18n.t('view.favorite.generated.new_instance')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!onWorldSelfInvite}
                                    onSelect={() => onWorldSelfInvite?.(item)}
                                >
                                    {appI18n.t('view.favorite.generated.new_instance_and_self_invite')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        ) : null}
                        {item.kind === 'avatar' ? (
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    disabled={!canSelectAvatar}
                                    onSelect={() => onAvatarSelect?.(item)}
                                >
                                    {appI18n.t('view.favorite.generated.select_avatar')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        ) : null}
                        {canRemoveLocal || canRemoveRemote ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onSelect={() => {
                                            if (canRemoveLocal) {
                                                onRemoveLocal(item);
                                                return;
                                            }
                                            onRemoveRemote(item);
                                        }}
                                    >
                                        {item.source === 'local'
                                            ? 'Delete'
                                            : 'Unfavorite'}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    );
});

function FavoritesPage({ kind, embedded = false }) {
    const favoriteLoadStatus = useFavoriteStore((state) => state.loadStatus);
    const favoriteDetail = useFavoriteStore((state) => state.detail);
    const favoritesSortOrder = useFavoriteStore(
        (state) => state.favoritesSortOrder
    );
    const remoteFavoritesById = useFavoriteStore(
        (state) => state.remoteFavoritesById
    );
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const favoriteWorldGroups = useFavoriteStore(
        (state) => state.favoriteWorldGroups
    );
    const favoriteAvatarGroups = useFavoriteStore(
        (state) => state.favoriteAvatarGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localWorldFavorites = useFavoriteStore(
        (state) => state.localWorldFavorites
    );
    const localAvatarFavorites = useFavoriteStore(
        (state) => state.localAvatarFavorites
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const localWorldFavoriteGroups = useFavoriteStore(
        (state) => state.localWorldFavoriteGroups
    );
    const localAvatarFavoriteGroups = useFavoriteStore(
        (state) => state.localAvatarFavoriteGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const localWorldDetailsById = useFavoriteStore(
        (state) => state.localWorldDetailsById
    );
    const localAvatarDetailsById = useFavoriteStore(
        (state) => state.localAvatarDetailsById
    );
    const favoriteWorldIds = useFavoriteStore(
        (state) => state.favoriteWorldIds
    );
    const favoriteAvatarIds = useFavoriteStore(
        (state) => state.favoriteAvatarIds
    );
    const favoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const removeLocalFavorite = useFavoriteStore(
        (state) => state.removeLocalFavorite
    );
    const removeRemoteFavorite = useFavoriteStore(
        (state) => state.removeRemoteFavorite
    );
    const createLocalFavoriteGroup = useFavoriteStore(
        (state) => state.createLocalFavoriteGroup
    );
    const renameLocalFavoriteGroup = useFavoriteStore(
        (state) => state.renameLocalFavoriteGroup
    );
    const deleteLocalFavoriteGroup = useFavoriteStore(
        (state) => state.deleteLocalFavoriteGroup
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
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
    const [remoteDetailsRefreshToken, setRemoteDetailsRefreshToken] =
        useState(0);
    const [splitterSizePx, setSplitterSizePx] = useState(
        SPLITTER_DEFAULT_SIZE_PX
    );
    const [splitterLayoutVersion, setSplitterLayoutVersion] = useState(0);
    const [cardScale, setCardScale] = useState(1);
    const [cardSpacing, setCardSpacing] = useState(1);
    const removingFavoriteKeyRef = useRef('');
    const pendingSplitterSizePxRef = useRef(null);
    const selectedKeysSet = useMemo(
        () => new Set(selectedKeys),
        [selectedKeys]
    );
    const friendsMap = useMemo(
        () => new Map(Object.entries(friendsById || {})),
        [friendsById]
    );
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
    const canSendInvite = Boolean(
        gameState?.isGameRunning &&
        currentInviteLocation &&
        canInviteFromCurrentLocation
    );
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
            kind === 'world'
                ? favoriteWorldIds
                : kind === 'avatar'
                  ? favoriteAvatarIds
                  : [],
        avatarTags,
        refreshToken: remoteDetailsRefreshToken,
        enabled:
            kind !== 'friend' &&
            favoriteLoadStatus === 'ready' &&
            (kind === 'world'
                ? favoriteWorldIds.length > 0
                : favoriteAvatarIds.length > 0)
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
                setSplitterSizePx(normalizeSplitterSizePx(parsed));
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
                setCardScale(
                    clampNumber(
                        nextScale,
                        CARD_SCALE_SLIDER.min,
                        CARD_SCALE_SLIDER.max,
                        1
                    )
                );
                setCardSpacing(
                    clampNumber(
                        nextSpacing,
                        CARD_SPACING_SLIDER.min,
                        CARD_SPACING_SLIDER.max,
                        1
                    )
                );
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
        avatarLocalRepository
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
                const rows = await avatarLocalRepository.getAvatarHistory(
                    currentUserId,
                    100
                );
                setAvatarHistory(Array.isArray(rows) ? rows : []);
            }
            toast.success(appI18n.t('view.favorite.generated.favorites_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_refresh_favorites')
            );
        } finally {
            setRefreshing(false);
        }
    };

    const handleSortValueChange = (value) => {
        setSortValue(value);
        if (value === 'date' || value === 'name') {
            const nextSortByDate = value === 'date';
            void setBoolConfigPreference('sortFavorites', nextSortByDate).catch(
                (error) => {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : appI18n.t('view.favorites.generated_toast.failed_to_save_favorite_sort_preference')
                    );
                }
            );
        }
    };

    const handleCardScaleChange = (value) => {
        const nextValue = clampNumber(
            value,
            CARD_SCALE_SLIDER.min,
            CARD_SCALE_SLIDER.max,
            1
        );
        setCardScale(nextValue);
        void configRepository.setString(
            CARD_SCALE_CONFIG_KEYS[kind],
            String(nextValue)
        );
    };

    const handleCardSpacingChange = (value) => {
        const nextValue = clampNumber(
            value,
            CARD_SPACING_SLIDER.min,
            CARD_SPACING_SLIDER.max,
            1
        );
        setCardSpacing(nextValue);
        void configRepository.setString(
            CARD_SPACING_CONFIG_KEYS[kind],
            String(nextValue)
        );
    };

    const handleRemoveLocalFavorite = async (item, { silent = false } = {}) => {
        if (
            !item ||
            item.source !== 'local' ||
            (!silent && removingFavoriteKeyRef.current)
        ) {
            return false;
        }

        if (!silent) {
            removingFavoriteKeyRef.current = item.key;
            setRemovingFavoriteKey(item.key);
            const result = await confirm({
                title: appI18n.t('view.favorites.generated_modal.remove_local_favorite'),
                description: appI18n.t('view.favorites.generated_dynamic.remove_value_from_value', { value: item.title || 'favorite', value2: item.groupLabel || 'Favorites' }),
                destructive: true,
                confirmText: appI18n.t('common.actions.remove'),
                cancelText: appI18n.t('common.actions.cancel')
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
                toast.success(appI18n.t('view.favorite.generated.local_favorite_removed'));
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_remove_local_favorite')
            );
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

    const handleRemoveRemoteFavorite = async (
        item,
        { silent = false } = {}
    ) => {
        if (
            !item ||
            item.source !== 'remote' ||
            (!silent && removingFavoriteKeyRef.current)
        ) {
            return false;
        }

        if (!silent) {
            removingFavoriteKeyRef.current = item.key;
            setRemovingFavoriteKey(item.key);
            const result = await confirm({
                title: appI18n.t('view.favorites.generated_modal.remove_vrchat_favorite'),
                description: appI18n.t('view.favorites.generated_dynamic.remove_value_from_value', { value: item.title || 'favorite', value2: item.groupLabel || 'Favorites' }),
                destructive: true,
                confirmText: appI18n.t('common.actions.remove'),
                cancelText: appI18n.t('common.actions.cancel')
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
                toast.success(appI18n.t('view.favorite.generated.vrchat_favorite_removed'));
            }
            return true;
        } catch (error) {
            if (silent) {
                throw error;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_remove_vrchat_favorite')
            );
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
            description: 'Remote world favorites with local cache fallback.',
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
            name:
                group.name ||
                String(group.key || '')
                    .split(':')
                    .pop() ||
                '',
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
        return [
            {
                source: 'history',
                key: 'local-history',
                label: 'Local History',
                count: avatarHistory.length,
                capacity: 100,
                visibility: ''
            }
        ];
    }, [avatarHistory.length, kind]);

    const remoteGroupLabelByKey = useMemo(
        () =>
            Object.fromEntries(
                remoteGroups.map((group) => [group.key, group.label])
            ),
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
                    const status =
                        friend?.stateBucket || friend?.state || 'offline';
                    const location = resolvePresenceLocation(friend);
                    const subtitle = friend
                        ? location && location !== 'offline'
                            ? location
                            : friend?.statusDescription || ''
                        : '';

                    return {
                        key: `remote:${group.key}:${normalizedId}`,
                        kind,
                        source: 'remote',
                        groupKey: group.key,
                        groupLabel: group.label,
                        id: normalizedId,
                        title:
                            friend?.displayName || friend?.username || 'User',
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

        const remoteFavorites = Object.values(remoteFavoritesById).filter(
            (favorite) => {
                if (kind === 'avatar') {
                    return favorite?.type === 'avatar';
                }
                return (
                    favorite?.type === 'world' ||
                    favorite?.type === 'vrcPlusWorld'
                );
            }
        );

        for (const favorite of remoteFavorites) {
            const favoriteId = normalizeEntityId(favorite.favoriteId);
            const groupKey = favorite.$groupKey;
            if (!favoriteId || !groupKey || !itemsByGroup[groupKey]) {
                continue;
            }

            const detail = remoteEntityDetails.data[favoriteId];
            const isUnavailable =
                remoteEntityDetails.status === 'ready' && !detail;
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
                orderIndex:
                    favoritesSortIndex[favoriteId] ?? Number.MAX_SAFE_INTEGER
            });
        }

        for (const group of remoteGroups) {
            itemsByGroup[group.key] = sortItems(
                itemsByGroup[group.key] || [],
                sortValue
            );
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
                    const status =
                        friend?.stateBucket || friend?.state || 'offline';
                    const location = resolvePresenceLocation(friend);
                    return {
                        key: `local:${group.key}:${normalizedId}`,
                        kind,
                        source: 'local',
                        groupKey: group.key,
                        groupLabel: group.label,
                        id: normalizedId,
                        title:
                            friend?.displayName || friend?.username || 'User',
                        titleColor: friend?.$userColour || '',
                        subtitle: friend
                            ? location && location !== 'offline'
                                ? location
                                : friend?.statusDescription || ''
                            : '',
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

        const localFavorites =
            kind === 'avatar' ? localAvatarFavorites : localWorldFavorites;
        const localDetailsById =
            kind === 'avatar' ? localAvatarDetailsById : localWorldDetailsById;

        for (const group of localGroups) {
            const ids = Array.isArray(localFavorites[group.key])
                ? localFavorites[group.key]
                : [];
            const items = ids.map((entityId, index) => {
                const normalizedId = normalizeEntityId(entityId);
                const detail = localDetailsById[normalizedId] || {
                    id: normalizedId
                };
                const playerCount = Number(detail.occupants) || 0;
                return {
                    key: `local:${group.key}:${normalizedId}`,
                    kind,
                    source: 'local',
                    groupKey: group.key,
                    groupLabel: group.label,
                    id: normalizedId,
                    title:
                        detail.name || (kind === 'world' ? 'World' : 'Avatar'),
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
                imageUrl: shrinkImage(
                    detail?.thumbnailImageUrl || detail?.imageUrl || ''
                ),
                isPrivate: detail?.releaseStatus === 'private',
                isUnavailable: false,
                tags: detail?.tags || [],
                playerCount: 0,
                orderIndex: index
            };
        });
    }, [avatarHistory, kind]);

    const allItems = useMemo(
        () => [
            ...Object.values(remoteItemsByGroup).flat(),
            ...Object.values(localItemsByGroup).flat()
        ],
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
                const matchesTag =
                    Array.isArray(item.tags) &&
                    item.tags.some(
                        (tag) =>
                            typeof tag === 'string' &&
                            tag.startsWith('author_tag_') &&
                            tag
                                .substring(11)
                                .toLowerCase()
                                .includes(searchNeedle)
                    );
                if (!matchesTag) {
                    return false;
                }
            } else {
                const matchesText = [
                    item.title,
                    item.subtitle,
                    item.description,
                    item.id,
                    item.groupLabel,
                    item.statusLabel
                ]
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
        const hasSelection = (
            selectedSource === 'remote'
                ? remoteGroups
                : selectedSource === 'history'
                  ? avatarHistoryGroups
                  : localGroups
        ).some((group) => group.key === selectedGroupKey);
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
    }, [
        avatarHistoryGroups,
        localGroups,
        remoteGroups,
        selectedGroupKey,
        selectedSource
    ]);

    const selectedGroup = useMemo(
        () =>
            (selectedSource === 'remote'
                ? remoteGroups
                : selectedSource === 'history'
                  ? avatarHistoryGroups
                  : localGroups
            ).find((group) => group.key === selectedGroupKey) || null,
        [
            avatarHistoryGroups,
            localGroups,
            remoteGroups,
            selectedGroupKey,
            selectedSource
        ]
    );
    const selectedItems = useMemo(() => {
        if (!selectedGroup) {
            return EMPTY_ITEMS;
        }
        if (selectedSource === 'history') {
            return avatarHistoryItems;
        }
        return (
            (selectedSource === 'remote'
                ? remoteItemsByGroup[selectedGroup.key]
                : localItemsByGroup[selectedGroup.key]) || EMPTY_ITEMS
        );
    }, [
        avatarHistoryItems,
        localItemsByGroup,
        remoteItemsByGroup,
        selectedGroup,
        selectedSource
    ]);
    const contentItems = useMemo(
        () => (isSearchActive ? filteredItems : selectedItems),
        [filteredItems, isSearchActive, selectedItems]
    );
    const isAllSelected =
        contentItems.length > 0 &&
        contentItems.every((item) => selectedKeysSet.has(item.key));
    const hasSelection = selectedKeys.length > 0;
    const avatarEditSelectionDisabled =
        kind === 'avatar' && selectedSource !== 'remote';
    const editModeDisabled =
        isSearchActive ||
        !selectedGroup ||
        contentItems.length === 0 ||
        avatarEditSelectionDisabled;
    const showCopyButton = selectedSource !== 'local';
    const selectedContentItems = contentItems.filter((item) =>
        selectedKeysSet.has(item.key)
    );
    const canCreateLocalGroup =
        kind !== 'avatar' ||
        Boolean(
            currentUserSnapshot?.$isVRCPlus ||
            currentUserSnapshot?.tags?.includes?.('system_supporter')
        );

    useEffect(() => {
        if (isSearchActive && editMode) {
            setEditMode(false);
            setSelectedKeys([]);
        }
    }, [editMode, isSearchActive]);

    useEffect(() => {
        setSelectedKeys((keys) => {
            const nextKeys = keys.filter((key) =>
                contentItems.some((item) => item.key === key)
            );
            return nextKeys.length === keys.length ? keys : nextKeys;
        });
    }, [contentItems]);

    async function exportCurrentFavorites() {
        if (!allItems.length) {
            toast.error(appI18n.t('view.favorite.generated.no_favorites_available_to_export'));
            return;
        }

        setExportDialogOpen(true);
    }

    async function handleRemoteGroupRename(group) {
        const result = await prompt({
            title: appI18n.t('view.favorites.generated_modal.change_favorite_group_name'),
            description: appI18n.t('view.favorites.generated_modal.enter_the_new_display_name'),
            inputValue: group.label || group.name,
            pattern: /\S+/,
            confirmText: appI18n.t('view.favorites.generated_modal.change'),
            cancelText: appI18n.t('common.actions.cancel'),
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
            toast.success(appI18n.t('view.favorite.generated.favorite_group_renamed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_rename_favorite_group')
            );
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
            toast.success(appI18n.t('view.favorite.generated.group_visibility_changed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_change_group_visibility')
            );
        }
    }

    async function handleRemoteGroupClear(group) {
        const result = await confirm({
            title: appI18n.t('view.favorites.generated_modal.clear_favorite_group'),
            description: appI18n.t('view.favorites.generated_modal.remove_all_favorites_from_this_group'),
            destructive: true,
            confirmText: appI18n.t('common.actions.clear'),
            cancelText: appI18n.t('common.actions.cancel')
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
            toast.success(appI18n.t('view.favorite.generated.favorite_group_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_clear_favorite_group')
            );
        }
    }

    async function handleLocalGroupRename(group) {
        const result = await prompt({
            title: appI18n.t('view.favorites.generated_modal.rename_local_favorite_group'),
            description: appI18n.t('view.favorites.generated_modal.enter_the_new_local_group_name'),
            inputValue: group.label,
            pattern: /\S+/,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel'),
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
            toast.error(appI18n.t('view.favorites.generated_dynamic.local_group_value_already_exists', { value: nextName }));
            return;
        }

        try {
            await localFavoritesRepository.renameLocalFavoriteGroup({
                kind,
                groupName: group.key,
                newGroupName: nextName
            });
            renameLocalFavoriteGroup({
                kind,
                groupName: group.key,
                newGroupName: nextName
            });
            if (selectedSource === 'local' && selectedGroupKey === group.key) {
                setSelectedGroupKey(nextName);
            }
            toast.success(appI18n.t('view.favorite.generated.local_favorite_group_renamed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_rename_local_favorite_group')
            );
        }
    }

    async function handleLocalGroupDelete(group) {
        const result = await confirm({
            title: appI18n.t('view.favorites.generated_modal.delete_local_favorite_group'),
            description: appI18n.t('view.favorites.generated_modal.delete_value', { value: group.label }),
            destructive: true,
            confirmText: appI18n.t('common.actions.delete'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            await localFavoritesRepository.deleteLocalFavoriteGroup({
                kind,
                groupName: group.key
            });
            deleteLocalFavoriteGroup({ kind, groupName: group.key });
            if (selectedSource === 'local' && selectedGroupKey === group.key) {
                setSelectedGroupKey('');
            }
            toast.success(appI18n.t('view.favorite.generated.local_favorite_group_deleted'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_delete_local_favorite_group')
            );
        }
    }

    async function refreshAvatarHistory() {
        if (kind !== 'avatar' || !currentUserId || avatarHistoryLoading) {
            return;
        }

        setAvatarHistoryLoading(true);
        try {
            const rows = await avatarLocalRepository.getAvatarHistory(
                currentUserId,
                100
            );
            setAvatarHistory(Array.isArray(rows) ? rows : []);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_refresh_avatar_history')
            );
        } finally {
            setAvatarHistoryLoading(false);
        }
    }

    async function handleAvatarHistoryClear() {
        const result = await confirm({
            title: appI18n.t('view.favorites.generated_modal.clear_avatar_history'),
            description:
                appI18n.t('view.favorites.generated_modal.clear_local_avatar_history_and_cached_avatar_met'),
            destructive: true,
            confirmText: appI18n.t('common.actions.clear'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        try {
            await avatarLocalRepository.clearAvatarHistory(currentUserId);
            setAvatarHistory([]);
            if (selectedSource === 'history') {
                setSelectedGroupKey('');
            }
            toast.success(appI18n.t('view.favorite.generated.avatar_history_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_clear_avatar_history')
            );
        }
    }

    function getFavoriteFriend(item) {
        const userId = normalizeEntityId(item?.id);
        return (
            item?.seedData ||
            friendsById[userId] || {
                id: userId,
                displayName: item?.title || userId,
                location: ''
            }
        );
    }

    async function launchFavoriteFriendLocation(item) {
        const friend = getFavoriteFriend(item);
        const location = resolvePresenceLocation(friend);
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }

        try {
            const opened = await tryOpenLaunchLocation(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            if (opened) {
                toast.success(appI18n.t('view.favorite.generated.vrchat_launch_request_sent'));
                return;
            }
            toast.error(appI18n.t('view.favorite.generated.unable_to_open_this_instance_in_vrchat'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_launch_instance')
            );
        }
    }

    async function selfInviteFavoriteFriendLocation(item) {
        const friend = getFavoriteFriend(item);
        const location = resolvePresenceLocation(friend);
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            return;
        }
        if (
            !checkCanInviteSelf(location, {
                currentUserId,
                cachedInstances: new Map(),
                friends: friendsMap
            })
        ) {
            toast.error(appI18n.t('view.favorite.generated.cannot_self_invite_to_this_instance'));
            return;
        }

        try {
            await selfInviteToInstance(
                location,
                parsedLocation.shortName || '',
                currentEndpoint
            );
            toast.success(appI18n.t('view.favorite.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_send_self_invite')
            );
        }
    }

    async function sendFavoriteFriendInvite(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }
        if (!currentInviteLocation) {
            toast.error(
                appI18n.t('view.favorite.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(appI18n.t('view.favorite.generated.cannot_invite_from_the_current_instance_type'));
            return;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                appI18n.t('view.favorite.generated.cannot_invite_current_location_is_not_a_concrete_instance')
            );
            return;
        }

        const result = await confirm({
            title: appI18n.t('view.favorites.generated_modal.send_invite'),
            description: friend?.displayName || 'this user',
            confirmText: appI18n.t('view.favorites.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
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
                    worldName:
                        worldResponse.json?.name || parsedLocation.worldId,
                    rsvp: true
                }
            });
            toast.success(appI18n.t('view.favorite.generated.invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_send_invite')
            );
        }
    }

    async function requestFavoriteFriendInvite(item) {
        const friend = getFavoriteFriend(item);
        const friendId = normalizeEntityId(friend?.id || item?.id);
        if (!friendId || friendId === normalizeEntityId(currentUserId)) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('view.favorites.generated_modal.request_invite'),
            description: friend?.displayName || 'this user',
            confirmText: appI18n.t('view.favorites.generated_modal.request_invite_2'),
            cancelText: appI18n.t('common.actions.cancel')
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
            toast.success(appI18n.t('view.favorite.generated.invite_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_request_invite')
            );
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
                title: appI18n.t('view.favorites.generated_modal.send_boop'),
                description:
                    appI18n.t('view.favorites.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
                inputValue: '',
                confirmText: appI18n.t('view.favorites.generated_modal.send'),
                cancelText: appI18n.t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }
            await notificationRepository.sendBoop({
                userId: friendId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(appI18n.t('view.favorite.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('view.favorites.generated_toast.failed_to_send_boop')
            );
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
        const shouldConfirm = await configRepository.getBool(
            'showConfirmationOnSwitchAvatar',
            true
        );
        if (shouldConfirm) {
            const result = await confirm({
                title: appI18n.t('view.favorites.generated_modal.select_avatar'),
                description: item.title || 'Avatar',
                confirmText: appI18n.t('common.actions.select'),
                cancelText: appI18n.t('common.actions.cancel')
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
            toast.success(appI18n.t('view.favorite.generated.avatar_selected'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_select_avatar')
            );
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
            toast.error(appI18n.t('view.favorites.generated_dynamic.local_group_value_already_exists', { value: nextName }));
            return;
        }
        try {
            await localFavoritesRepository.createLocalFavoriteGroup({
                kind,
                groupName: nextName
            });
            createLocalFavoriteGroup({ kind, groupName: nextName });
            setSelectedSource('local');
            setSelectedGroupKey(nextName);
            setCreatingLocalGroup(false);
            setNewLocalGroupName('');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_create_local_favorite_group')
            );
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
            await navigator.clipboard.writeText(
                selectedContentItems.map((item) => `${item.id}\n`).join('')
            );
            toast.success(appI18n.t('view.favorite.generated.copied_selected_favorite_ids'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.favorites.generated_toast.failed_to_copy_selected_favorites')
            );
        }
    }

    async function bulkRemoveSelection() {
        if (!selectedContentItems.length) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('view.favorites.generated_modal.delete_value_favorites', { value: selectedContentItems.length }),
            description: appI18n.t('view.favorites.generated_modal.this_action_cannot_be_undone'),
            destructive: true,
            confirmText: appI18n.t('common.actions.delete'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        let removedCount = 0;
        let failedCount = 0;
        const removedKeys = new Set();
        for (const item of selectedContentItems) {
            try {
                const removed =
                    item.source === 'local'
                        ? await handleRemoveLocalFavorite(item, {
                              silent: true
                          })
                        : await handleRemoveRemoteFavorite(item, {
                              silent: true
                          });
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
            toast.success(appI18n.t('view.favorite.generated.selected_favorites_removed'));
            return;
        }
        toast.error(appI18n.t('view.favorites.generated_dynamic.removed_value_value_failed', { value: removedCount, value2: failedCount }));
    }

    function persistSplitterSizePx(nextSizePx) {
        const normalizedSizePx = normalizeSplitterSizePx(nextSizePx);
        setSplitterSizePx(normalizedSizePx);
        void configRepository.setString(
            SPLITTER_CONFIG_KEYS[kind],
            String(normalizedSizePx)
        );
    }

    function handleSplitterResize(panelSize) {
        const nextSizePx = Number(panelSize?.inPixels);
        if (!Number.isFinite(nextSizePx) || nextSizePx < 0) {
            return;
        }
        pendingSplitterSizePxRef.current = normalizeSplitterSizePx(nextSizePx);
    }

    function persistSplitterLayout() {
        const pendingSizePx = pendingSplitterSizePxRef.current;
        pendingSplitterSizePxRef.current = null;
        if (Number.isFinite(pendingSizePx)) {
            persistSplitterSizePx(pendingSizePx);
        }
    }

    const handleCardToggleSelect = useStableEvent((itemKey, checked) => {
        setSelectedKeys((keys) =>
            checked
                ? Array.from(new Set([...keys, itemKey]))
                : keys.filter((key) => key !== itemKey)
        );
    });
    const handleCardFriendLaunch = useStableEvent((entry) =>
        launchFavoriteFriendLocation(entry)
    );
    const handleCardFriendSelfInvite = useStableEvent((entry) =>
        selfInviteFavoriteFriendLocation(entry)
    );
    const handleCardFriendInvite = useStableEvent((entry) =>
        sendFavoriteFriendInvite(entry)
    );
    const handleCardFriendRequestInvite = useStableEvent((entry) =>
        requestFavoriteFriendInvite(entry)
    );
    const handleCardFriendBoop = useStableEvent((entry) =>
        sendFavoriteFriendBoop(entry)
    );
    const handleCardWorldNewInstance = useStableEvent((entry) =>
        openWorldNewInstance(entry, false)
    );
    const handleCardWorldSelfInvite = useStableEvent((entry) =>
        openWorldNewInstance(entry, true)
    );
    const handleCardAvatarSelect = useStableEvent((entry) =>
        selectFavoriteAvatar(entry)
    );
    const handleCardRemoveLocalFavorite = useStableEvent((entry) =>
        handleRemoveLocalFavorite(entry)
    );
    const handleCardRemoveRemoteFavorite = useStableEvent((entry) =>
        handleRemoveRemoteFavorite(entry)
    );
    const handleGroupRailRefresh = useStableEvent(() => refreshFavorites());
    const handleGroupRailSelect = useStableEvent((group) => {
        setSearchQuery('');
        setSelectedSource(group.source);
        setSelectedGroupKey(group.key);
    });
    const handleStartCreateLocalGroup = useStableEvent(() => {
        setCreatingLocalGroup(true);
        setNewLocalGroupName('');
    });
    const handleCancelCreateLocalGroup = useStableEvent(() => {
        setCreatingLocalGroup(false);
        setNewLocalGroupName('');
    });
    const handleConfirmCreateLocalGroup = useStableEvent(
        confirmCreateLocalGroup
    );
    const handleAvatarHistoryRefreshEvent =
        useStableEvent(refreshAvatarHistory);
    const handleAvatarHistoryClearEvent = useStableEvent(
        handleAvatarHistoryClear
    );
    const handleRemoteGroupRenameEvent = useStableEvent(
        handleRemoteGroupRename
    );
    const handleRemoteGroupVisibilityEvent = useStableEvent(
        handleRemoteGroupVisibility
    );
    const handleRemoteGroupClearEvent = useStableEvent(handleRemoteGroupClear);
    const handleLocalGroupRenameEvent = useStableEvent(handleLocalGroupRename);
    const handleLocalGroupDeleteEvent = useStableEvent(handleLocalGroupDelete);
    const handleSplitterResizeEvent = useStableEvent(handleSplitterResize);
    const persistSplitterLayoutEvent = useStableEvent(persistSplitterLayout);

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
            className={cn(
                'flex h-full min-h-0 flex-1 flex-col',
                embedded ? 'p-4 pb-0' : 'x-container pb-0'
            )}
        >
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

            <div className="flex h-full min-h-0 min-w-0 flex-1">
                <ResizablePanelGroup
                    key={`${kind}:${splitterLayoutVersion}`}
                    id={`favorites-${kind}-splitter`}
                    orientation="horizontal"
                    className="h-full min-h-0 min-w-0 flex-1"
                    onLayoutChanged={persistSplitterLayoutEvent}
                >
                    <ResizablePanel
                        id={`favorites-${kind}-groups`}
                        defaultSize={splitterSizePx}
                        minSize={SPLITTER_MIN_SIZE_PX}
                        className="min-w-0"
                        collapsible
                        collapsedSize={0}
                        groupResizeBehavior="preserve-pixel-size"
                        onResize={handleSplitterResizeEvent}
                    >
                        <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-2">
                            <GroupRailSection
                                title={pageConfig.remoteSectionTitle}
                                groups={remoteGroups}
                                selectedSource={
                                    hasSearchInput ? '' : selectedSource
                                }
                                selectedGroupKey={
                                    hasSearchInput ? '' : selectedGroupKey
                                }
                                loading={
                                    favoriteLoadStatus === 'running' ||
                                    refreshing
                                }
                                onRefresh={handleGroupRailRefresh}
                                onSelect={handleGroupRailSelect}
                                onRemoteRename={handleRemoteGroupRenameEvent}
                                onRemoteVisibility={
                                    handleRemoteGroupVisibilityEvent
                                }
                                onRemoteClear={handleRemoteGroupClearEvent}
                                onLocalRename={handleLocalGroupRenameEvent}
                                onLocalDelete={handleLocalGroupDeleteEvent}
                            />
                            <GroupRailSection
                                title={pageConfig.localSectionTitle}
                                groups={localGroups}
                                selectedSource={
                                    hasSearchInput ? '' : selectedSource
                                }
                                selectedGroupKey={
                                    hasSearchInput ? '' : selectedGroupKey
                                }
                                loading={refreshing}
                                creating={creatingLocalGroup}
                                newGroupName={newLocalGroupName}
                                showNewGroup={canCreateLocalGroup}
                                onRefresh={handleGroupRailRefresh}
                                onSelect={handleGroupRailSelect}
                                onStartCreate={handleStartCreateLocalGroup}
                                onNewGroupNameChange={setNewLocalGroupName}
                                onConfirmCreate={handleConfirmCreateLocalGroup}
                                onCancelCreate={handleCancelCreateLocalGroup}
                                onRemoteRename={handleRemoteGroupRenameEvent}
                                onRemoteVisibility={
                                    handleRemoteGroupVisibilityEvent
                                }
                                onRemoteClear={handleRemoteGroupClearEvent}
                                onLocalRename={handleLocalGroupRenameEvent}
                                onLocalDelete={handleLocalGroupDeleteEvent}
                            />
                            {kind === 'avatar' ? (
                                <GroupRailSection
                                    title={appI18n.t('view.favorite.avatars.local_history')}
                                    groups={avatarHistoryGroups}
                                    selectedSource={
                                        hasSearchInput ? '' : selectedSource
                                    }
                                    selectedGroupKey={
                                        hasSearchInput ? '' : selectedGroupKey
                                    }
                                    loading={avatarHistoryLoading}
                                    onRefresh={handleAvatarHistoryRefreshEvent}
                                    onSelect={handleGroupRailSelect}
                                    onRemoteRename={
                                        handleRemoteGroupRenameEvent
                                    }
                                    onRemoteVisibility={
                                        handleRemoteGroupVisibilityEvent
                                    }
                                    onRemoteClear={handleRemoteGroupClearEvent}
                                    onLocalRename={handleLocalGroupRenameEvent}
                                    onLocalDelete={handleLocalGroupDeleteEvent}
                                    onHistoryClear={
                                        handleAvatarHistoryClearEvent
                                    }
                                />
                            ) : null}
                        </div>
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        id={`favorites-${kind}-content`}
                        minSize={SPLITTER_CONTENT_MIN_SIZE_PX}
                        className="min-w-0"
                    >
                        <div className="flex h-full min-h-0 min-w-0 flex-col pl-[26px]">
                            <FavoritesContentHeader
                                title={title}
                                subtitle={subtitle}
                                editMode={editMode}
                                editModeDisabled={editModeDisabled}
                                editModeVisible={
                                    editMode &&
                                    !isSearchActive &&
                                    !avatarEditSelectionDisabled
                                }
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
                            <div className="min-h-0 min-w-0 flex-1 overflow-auto pr-2">
                                {favoriteLoadStatus === 'running' &&
                                !contentItems.length ? (
                                    <FavoritesLoadingState title={appI18n.t('view.favorite.generated.loading_favorites_baseline')} />
                                ) : favoriteLoadStatus === 'error' ? (
                                    <FavoritesEmptyState
                                        title={appI18n.t('view.favorite.generated.favorites_failed_to_load')}
                                        description={
                                            favoriteDetail ||
                                            'The favorites baseline did not finish loading.'
                                        }
                                    />
                                ) : kind !== 'friend' &&
                                  remoteEntityDetails.status === 'running' &&
                                  !Object.keys(remoteEntityDetails.data)
                                      .length &&
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
                                        title={
                                            isSearchActive
                                                ? 'No matches found'
                                                : 'No data'
                                        }
                                        description={
                                            isSearchActive
                                                ? 'Try a different search term.'
                                                : 'The selected group currently has no items.'
                                        }
                                    />
                                ) : (
                                    <div
                                        className="grid min-w-0"
                                        style={{
                                            gap: `${Math.max(4, Math.round(8 * cardSpacing))}px`,
                                            gridTemplateColumns: `repeat(auto-fill,minmax(${Math.round(260 * cardScale)}px,1fr))`
                                        }}
                                    >
                                        {contentItems.map((item) => (
                                            <FavoriteCard
                                                key={item.key}
                                                item={item}
                                                editMode={
                                                    editMode && !isSearchActive
                                                }
                                                selected={selectedKeysSet.has(
                                                    item.key
                                                )}
                                                showGroupLabel={isSearchActive}
                                                cardScale={cardScale}
                                                cardSpacing={cardSpacing}
                                                removing={
                                                    removingFavoriteKey ===
                                                    item.key
                                                }
                                                canSendInvite={canSendInvite}
                                                canBoop={canBoop}
                                                currentUserId={currentUserId}
                                                currentAvatarId={
                                                    currentUserSnapshot?.currentAvatar ||
                                                    ''
                                                }
                                                onToggleSelect={
                                                    handleCardToggleSelect
                                                }
                                                onRemoveLocal={
                                                    handleCardRemoveLocalFavorite
                                                }
                                                onRemoveRemote={
                                                    handleCardRemoveRemoteFavorite
                                                }
                                                onFriendLaunch={
                                                    handleCardFriendLaunch
                                                }
                                                onFriendSelfInvite={
                                                    handleCardFriendSelfInvite
                                                }
                                                onFriendInvite={
                                                    handleCardFriendInvite
                                                }
                                                onFriendRequestInvite={
                                                    handleCardFriendRequestInvite
                                                }
                                                onFriendBoop={
                                                    handleCardFriendBoop
                                                }
                                                onWorldNewInstance={
                                                    handleCardWorldNewInstance
                                                }
                                                onWorldSelfInvite={
                                                    handleCardWorldSelfInvite
                                                }
                                                onAvatarSelect={
                                                    handleCardAvatarSelect
                                                }
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
