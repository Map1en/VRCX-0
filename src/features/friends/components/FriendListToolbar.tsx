import { StarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { FriendListSearchFilterDropdown } from './FriendListViewParts';

export function FriendListToolbar({
    bulkModel,
    filterModel,
    loadModel,
    table,
    toolbarCommands
}: any) {
    const { t } = useTranslation();
    const {
        activeSearchFilterIds,
        favoritesOnly,
        isFavoritesLoaded,
        searchQuery
    } = filterModel;
    const { bulkUnfriendMode, isBulkDeleting, selectedFriendCount } = bulkModel;
    const {
        currentUserId,
        isLoadingUserDetails,
        isMutualFetching,
        isMutualOptOut,
        mutualProgress,
        statusDetail: rawStatusDetail
    } = loadModel;
    const {
        onBulkUnfriend,
        onBulkUnfriendModeChange,
        onLoadFriendUserDetails,
        onLoadMutualFriends,
        onResetTableLayout,
        onSearchChange,
        onSearchFilterChange,
        onToggleFavoritesOnly
    } = toolbarCommands;
    const statusDetail = isMutualFetching
        ? t('view.friend_list.loading.loading_mutual_friends_progress', {
              current: mutualProgress?.current ?? 0,
              total: mutualProgress?.total ?? 0
          })
        : rawStatusDetail;

    return (
        <PageToolbar>
            <PageToolbarRow className="justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant={favoritesOnly ? 'default' : 'outline'}
                                size="icon"
                                className="size-9"
                                disabled={!isFavoritesLoaded}
                                aria-label={t(
                                    'view.friend_list.favorites_only_tooltip'
                                )}
                                onClick={onToggleFavoritesOnly}
                            >
                                <StarIcon
                                    data-icon="inline-start"
                                    className={cn(
                                        favoritesOnly ? 'fill-current' : ''
                                    )}
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {t('view.friend_list.favorites_only_tooltip')}
                        </TooltipContent>
                    </Tooltip>
                    <FriendListSearchFilterDropdown
                        value={activeSearchFilterIds}
                        onChange={onSearchFilterChange}
                    />
                    <Input
                        value={searchQuery}
                        onChange={(event: any) =>
                            onSearchChange(event.target.value)
                        }
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
