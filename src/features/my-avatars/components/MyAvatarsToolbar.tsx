// @ts-nocheck
import {
    LayoutGridIcon,
    ListIcon,
    RefreshCwIcon,
    SearchIcon
} from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { Button } from '@/ui/shadcn/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    GridSettingsMenu,
    MyAvatarFilterPopover
} from './MyAvatarsViewParts';

export function MyAvatarsToolbar({
    t,
    viewMode,
    activeFilterCount,
    allTags,
    releaseStatusFilter,
    platformFilter,
    tagFilters,
    loadStatus,
    searchQuery,
    gridDensity,
    table,
    currentUserId,
    onViewModeChange,
    onReleaseStatusChange,
    onPlatformChange,
    onTagFiltersChange,
    onClearFilters,
    onSearchChange,
    onGridDensityChange,
    onRefresh
}) {
    return (
        <div className="flex shrink-0 flex-col gap-2 px-0.5 pt-1.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={viewMode}
                    onValueChange={(nextValue) => {
                        if (nextValue) {
                            onViewModeChange(nextValue);
                        }
                    }}
                    className="shrink-0"
                >
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <ToggleGroupItem
                                value="grid"
                                aria-label={t(
                                    'view.my_avatars.action.show_avatar_grid'
                                )}
                            >
                                <LayoutGridIcon data-icon="inline-start" />
                            </ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent>
                            {t('view.my_avatars.action.show_avatar_grid')}
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <ToggleGroupItem
                                value="table"
                                aria-label={t(
                                    'view.my_avatars.action.show_avatar_table'
                                )}
                            >
                                <ListIcon data-icon="inline-start" />
                            </ToggleGroupItem>
                        </TooltipTrigger>
                        <TooltipContent>
                            {t('view.my_avatars.action.show_avatar_table')}
                        </TooltipContent>
                    </Tooltip>
                </ToggleGroup>

                <MyAvatarFilterPopover
                    activeFilterCount={activeFilterCount}
                    allTags={allTags}
                    releaseStatusFilter={releaseStatusFilter}
                    platformFilter={platformFilter}
                    tagFilters={tagFilters}
                    onReleaseStatusChange={onReleaseStatusChange}
                    onPlatformChange={onPlatformChange}
                    onTagFiltersChange={onTagFiltersChange}
                    onClearFilters={onClearFilters}
                />

                {loadStatus === 'running' ? (
                    <span className="text-muted-foreground text-sm">
                        {t('common.loading')}
                    </span>
                ) : null}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
                <InputGroup className="min-w-52 flex-1 sm:max-w-md lg:w-80 lg:flex-none">
                    <InputGroupAddon>
                        <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={searchQuery}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={t('common.actions.search')}
                        aria-label={t('common.actions.search')}
                    />
                </InputGroup>
                {viewMode === 'grid' ? (
                    <GridSettingsMenu
                        gridDensity={gridDensity}
                        onGridDensityChange={onGridDensityChange}
                    />
                ) : null}
                {viewMode === 'table' ? (
                    <TableColumnVisibilityMenu table={table} />
                ) : null}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t(
                                'view.my_avatars.action.refresh_avatar_inventory'
                            )}
                            disabled={
                                !currentUserId || loadStatus === 'running'
                            }
                            onClick={onRefresh}
                        >
                            {loadStatus === 'running' ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <RefreshCwIcon data-icon="inline-start" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t(
                            'view.my_avatars.action.refresh_avatar_inventory'
                        )}
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>
    );
}
