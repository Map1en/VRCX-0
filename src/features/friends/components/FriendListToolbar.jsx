import { StarIcon } from 'lucide-react';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold.jsx';
import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

import { FriendListSearchFilterDropdown } from './FriendListViewParts.jsx';

export function FriendListToolbar({
    t,
    favoritesOnly,
    isFavoritesLoaded,
    activeSearchFilterIds,
    searchQuery,
    bulkUnfriendMode,
    selectedFriendCount,
    isBulkDeleting,
    isMutualOptOut,
    isMutualFetching,
    currentUserId,
    isLoadingUserDetails,
    table,
    statusDetail,
    onToggleFavoritesOnly,
    onSearchFilterChange,
    onSearchChange,
    onBulkUnfriend,
    onBulkUnfriendModeChange,
    onLoadMutualFriends,
    onLoadFriendUserDetails,
    onResetTableLayout
}) {
    return (
        <PageToolbar>
            <PageToolbarRow className="justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant={favoritesOnly ? 'default' : 'outline'}
                        size="icon"
                        className="size-9"
                        disabled={!isFavoritesLoaded}
                        title={t('view.friend_list.favorites_only_tooltip')}
                        aria-label={t(
                            'view.friend_list.favorites_only_tooltip'
                        )}
                        onClick={onToggleFavoritesOnly}
                    >
                        <StarIcon
                            data-icon="inline-start"
                            className={cn(favoritesOnly ? 'fill-current' : '')}
                        />
                    </Button>
                    <FriendListSearchFilterDropdown
                        value={activeSearchFilterIds}
                        onChange={onSearchFilterChange}
                    />
                    <Input
                        value={searchQuery}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={t('view.friend_list.search_placeholder')}
                        aria-label={t('view.friend_list.search_placeholder')}
                        className="h-9 w-64"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {bulkUnfriendMode ? (
                        <Button
                            type="button"
                            variant="outline"
                            className="h-9"
                            disabled={!selectedFriendCount || isBulkDeleting}
                            onClick={onBulkUnfriend}
                        >
                            {t('view.friend_list.bulk_unfriend_selection')}
                        </Button>
                    ) : null}
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">
                            {t('view.friend_list.bulk_unfriend')}
                        </span>
                        <Switch
                            aria-label={t('view.friend_list.bulk_unfriend')}
                            checked={bulkUnfriendMode}
                            disabled={!currentUserId || isBulkDeleting}
                            onCheckedChange={onBulkUnfriendModeChange}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        className="h-9 gap-2"
                        disabled={
                            isMutualOptOut || isMutualFetching || !currentUserId
                        }
                        onClick={onLoadMutualFriends}
                    >
                        {isMutualFetching ? (
                            <Spinner data-icon="inline-start" />
                        ) : null}
                        {t('view.friend_list.load_mutual_friends')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        disabled={isLoadingUserDetails || !currentUserId}
                        onClick={onLoadFriendUserDetails}
                    >
                        {t('view.friend_list.load')}
                    </Button>
                    <TableColumnVisibilityMenu
                        table={table}
                        onResetLayout={onResetTableLayout}
                    />
                </div>
            </PageToolbarRow>

            {statusDetail ? (
                <div className="text-muted-foreground text-xs">
                    {statusDetail}
                </div>
            ) : null}
        </PageToolbar>
    );
}
