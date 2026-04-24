import {
    ArrowUpDownIcon,
    DownloadIcon,
    EllipsisIcon,
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
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

const CARD_SCALE_SLIDER = { min: 0.6, max: 1, step: 0.01 };
const CARD_SPACING_SLIDER = { min: 0.5, max: 1.5, step: 0.05 };
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
    const { t } = useTranslation();

    const cardScalePercent = Math.round(cardScale * 100);
    const cardSpacingPercent = Math.round(cardSpacing * 100);

    return (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Select value={sortValue} onValueChange={onSortValueChange}>
                <SelectTrigger size="sm" className="min-w-48">
                    <span className="flex items-center gap-2">
                        <ArrowUpDownIcon className="size-4" />
                        <SelectValue placeholder={t('view.favorite.generated.sort_favorites')} />
                    </span>
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value="name">{t('view.search.avatar.sort_name')}</SelectItem>
                        <SelectItem value="date">{t('view.favorite.generated.sort_by_date')}</SelectItem>
                        {kind === 'world' ? (
                            <SelectItem value="players">
                                {t('view.favorite.generated.sort_by_players')}
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
                                {t('view.favorite.generated.name')}
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
                                    <FieldLabel>{t('view.friends_locations.scale')}</FieldLabel>
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
                                    <FieldLabel>{t('view.friends_locations.spacing')}</FieldLabel>
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
                                {t('view.favorite.import')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={onExport}>
                                <DownloadIcon data-icon="inline-start" />
                                {t('view.favorite.generated.export')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

export { FavoritesToolbar };
