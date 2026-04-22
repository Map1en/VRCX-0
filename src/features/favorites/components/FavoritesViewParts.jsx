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
import { memo, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Location } from '@/components/Location.jsx';
import { cn } from '@/lib/utils.js';
import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
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
} from '../favoritesExport.js';
import {
    normalizeFavoriteEntityId as normalizeEntityId
} from '../favoritesItems.js';
import { appI18n } from '@/services/i18nService.js';

const VISIBILITY_OPTIONS = ['public', 'friends', 'private'];
const CARD_SCALE_SLIDER = { min: 0.6, max: 1, step: 0.01 };
const CARD_SPACING_SLIDER = { min: 0.5, max: 1.5, step: 0.05 };
function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
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
export {
    FavoriteCard,
    FavoriteExportDialog,
    FavoritesContentHeader,
    FavoritesEmptyState,
    FavoritesLoadingState,
    FavoritesToolbar,
    GroupMenu,
    GroupRailSection
};
