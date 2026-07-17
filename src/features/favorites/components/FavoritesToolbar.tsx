import {
    ArrowUpDownIcon,
    DownloadIcon,
    EllipsisIcon,
    ExternalLinkIcon,
    RefreshCwIcon,
    SearchIcon,
    UploadIcon,
    XIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
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
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    FAVORITES_DENSITY_OPTIONS,
    type FavoritesDensity
} from '../favoritesDensity';
import type { FavoriteKind } from '../favoritesTypes';

type FavoritesToolbarProps = {
    kind: FavoriteKind;
    sortValue: string;
    searchQuery: string;
    searchPlaceholder: string;
    searchMode: string;
    density: FavoritesDensity;
    refreshing: boolean;
    onSortValueChange: (value: string) => void;
    onSearchChange: (value: string) => void;
    onSearchModeChange: (mode: string) => void;
    onDensityChange: (value: FavoritesDensity) => void;
    onRefresh: () => void;
    onImport: () => void;
    onExport: () => void;
    onManageShares?: () => void;
};

function FavoritesToolbar({
    kind,
    sortValue,
    searchQuery,
    searchPlaceholder,
    searchMode,
    density,
    refreshing,
    onSortValueChange,
    onSearchChange,
    onSearchModeChange,
    onDensityChange,
    onRefresh,
    onImport,
    onExport,
    onManageShares
}: FavoritesToolbarProps) {
    const { t } = useTranslation();

    return (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Select
                value={sortValue}
                items={[
                    {
                        value: 'name',
                        label: t('view.search.avatar.sort_name')
                    },
                    {
                        value: 'date',
                        label: t('view.favorite.label.sort_by_date')
                    },
                    ...(kind === 'world'
                        ? [
                              {
                                  value: 'players',
                                  label: t(
                                      'view.favorite.label.sort_by_players'
                                  )
                              }
                          ]
                        : [])
                ]}
                onValueChange={(value) => onSortValueChange(value ?? '')}
            >
                <SelectTrigger size="sm" className="min-w-48">
                    <span className="flex items-center gap-2">
                        <ArrowUpDownIcon className="size-4" />
                        <SelectValue
                            placeholder={t(
                                'view.favorite.label.sort_favorites'
                            )}
                        />
                    </span>
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value="name">
                            {t('view.search.avatar.sort_name')}
                        </SelectItem>
                        <SelectItem value="date">
                            {t('view.favorite.label.sort_by_date')}
                        </SelectItem>
                        {kind === 'world' ? (
                            <SelectItem value="players">
                                {t('view.favorite.label.sort_by_players')}
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
                                {t('view.favorite.worlds.search_mode_name')}
                            </InputGroupButton>
                            <InputGroupButton
                                type="button"
                                variant={
                                    searchMode === 'tag' ? 'default' : 'ghost'
                                }
                                onClick={() => onSearchModeChange('tag')}
                            >
                                {t('view.favorite.worlds.search_mode_tag')}
                            </InputGroupButton>
                        </InputGroupAddon>
                    ) : searchQuery ? (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton
                                type="button"
                                size="icon-xs"
                                aria-label={t('common.actions.clear')}
                                onClick={() => onSearchChange('')}
                            >
                                <XIcon data-icon="icon" />
                            </InputGroupButton>
                        </InputGroupAddon>
                    ) : null}
                </InputGroup>

                {kind === 'world' && onManageShares ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onManageShares}
                    >
                        <ExternalLinkIcon data-icon="inline-start" />
                        {t('view.favorite.share_collection.action.open_manage')}
                    </Button>
                ) : null}

                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('common.actions.refresh')}
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
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t('common.actions.configure')}
                            >
                                <EllipsisIcon data-icon="inline-start" />
                            </Button>
                        }
                    />
                    <DropdownMenuContent align="end" className="w-56">
                        <FieldGroup
                            className="gap-3 px-3 py-2"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <Field>
                                <FieldContent>
                                    <FieldLabel>
                                        {t('view.friends_locations.density')}
                                    </FieldLabel>
                                </FieldContent>
                                <ToggleGroup
                                    variant="outline"
                                    size="sm"
                                    spacing={1}
                                    value={density ? [density] : []}
                                    onValueChange={(nextValue) => {
                                        if (nextValue[0]) {
                                            onDensityChange(
                                                nextValue[0] as FavoritesDensity
                                            );
                                        }
                                    }}
                                    className="grid w-full grid-cols-2"
                                >
                                    {FAVORITES_DENSITY_OPTIONS.map((option) => (
                                        <ToggleGroupItem
                                            key={option.value}
                                            value={option.value}
                                            aria-label={t(option.labelKey)}
                                            className="w-full min-w-0 justify-center px-2"
                                        >
                                            <span className="truncate">
                                                {t(option.labelKey)}
                                            </span>
                                        </ToggleGroupItem>
                                    ))}
                                </ToggleGroup>
                            </Field>
                        </FieldGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={onImport}>
                                <UploadIcon data-icon="inline-start" />
                                {t('view.favorite.import')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onExport}>
                                <DownloadIcon data-icon="inline-start" />
                                {t('view.favorite.export')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

export { FavoritesToolbar };
