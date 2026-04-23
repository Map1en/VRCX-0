import {
    LayoutGridIcon,
    ListIcon,
    RefreshCwIcon
} from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    GridSettingsMenu,
    MyAvatarFilterPopover
} from './MyAvatarsViewParts.jsx';

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
    cardScale,
    cardSpacing,
    table,
    currentUserId,
    onViewModeChange,
    onReleaseStatusChange,
    onPlatformChange,
    onTagFiltersChange,
    onClearFilters,
    onSearchChange,
    onCardScaleChange,
    onCardSpacingChange,
    onRefresh
}) {
    return (
        <div className="flex flex-wrap items-center gap-2 px-0.5 pt-1.5">
            <div className="flex items-center gap-1">
                <Button
                    type="button"
                    size="icon-sm"
                    variant={viewMode === 'grid' ? 'default' : 'outline'}
                    aria-label={t('view.my_avatars.generated.show_avatar_grid')}
                    title={t('view.my_avatars.generated.show_avatar_grid')}
                    onClick={() => onViewModeChange('grid')}
                >
                    <LayoutGridIcon data-icon="inline-start" />
                </Button>
                <Button
                    type="button"
                    size="icon-sm"
                    variant={viewMode === 'table' ? 'default' : 'outline'}
                    aria-label={t('view.my_avatars.generated.show_avatar_table')}
                    title={t('view.my_avatars.generated.show_avatar_table')}
                    onClick={() => onViewModeChange('table')}
                >
                    <ListIcon data-icon="inline-start" />
                </Button>
            </div>

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

            <div className="flex-1" />

            {loadStatus === 'running' ? (
                <span className="text-muted-foreground text-sm">
                    {t('common.loading')}
                </span>
            ) : null}
            <Input
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={t('common.actions.search')}
                aria-label={t('common.actions.search')}
                className="w-80"
            />
            {viewMode === 'grid' ? (
                <GridSettingsMenu
                    cardScale={cardScale}
                    cardSpacing={cardSpacing}
                    onCardScaleChange={onCardScaleChange}
                    onCardSpacingChange={onCardSpacingChange}
                />
            ) : null}
            {viewMode === 'table' ? (
                <TableColumnVisibilityMenu table={table} />
            ) : null}
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t(
                    'view.my_avatars.generated.refresh_avatar_inventory'
                )}
                title={t('view.my_avatars.generated.refresh_avatar_inventory')}
                disabled={!currentUserId || loadStatus === 'running'}
                onClick={onRefresh}
            >
                {loadStatus === 'running' ? (
                    <Spinner data-icon="inline-start" />
                ) : (
                    <RefreshCwIcon data-icon="inline-start" />
                )}
            </Button>
        </div>
    );
}
