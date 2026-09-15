import {
    UserMinusIcon,
    UserRoundSearchIcon,
    WaypointsIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarOverflowMenu,
    ToolbarSearch,
    ToolbarStatus,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import { Button } from '@/ui/shadcn/button';
import { DropdownMenuGroup, DropdownMenuItem } from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

import type { FriendListRow } from '../friendListRows';
import {
    FriendListFilterDropdown,
    FriendListSearchScopeDropdown
} from './FriendListViewParts';

export function FriendListToolbar({
    bulkModel,
    filterModel,
    loadModel,
    table,
    toolbarCommands
}: {
    bulkModel: {
        bulkUnfriendMode: boolean;
        isBulkDeleting: boolean;
        selectedFriendCount: number;
    };
    filterModel: {
        activeSearchFilterIds: Set<string>;
        favoritesOnly: boolean;
        isFavoritesLoaded: boolean;
        searchQuery: string;
    };
    loadModel: {
        currentUserId: string | null;
        isLoadingUserDetails: boolean;
        isMutualFetching: boolean;
        isMutualOptOut: boolean;
        mutualProgress: { current: number; total: number };
    };
    table: AppTable<FriendListRow>;
    toolbarCommands: {
        onBulkUnfriend: () => void;
        onBulkUnfriendModeChange: (value: boolean) => void;
        onLoadFriendUserDetails: () => void;
        onLoadMutualFriends: () => void;
        onResetTableLayout: () => void;
        onSearchChange: (value: string) => void;
        onSearchFilterChange: (value: Set<string>) => void;
        onToggleFavoritesOnly: () => void;
    };
}) {
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
        mutualProgress
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
        : '';

    if (bulkUnfriendMode) {
        return (
            <PageToolbar>
                <PageToolbarRow>
                    <ToolbarViews>
                        <span className="text-sm font-medium tabular-nums">
                            {t('view.friend_list.bulk_selected', {
                                count: selectedFriendCount
                            })}
                        </span>
                    </ToolbarViews>

                    <ToolbarSearch
                        value={searchQuery}
                        onValueChange={onSearchChange}
                        placeholder={t('view.friend_list.search_placeholder')}
                    />

                    <ToolbarActions>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={!selectedFriendCount || isBulkDeleting}
                            onClick={onBulkUnfriend}
                        >
                            {isBulkDeleting ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <UserMinusIcon data-icon="inline-start" />
                            )}
                            {t('view.friend_list.bulk_unfriend_selection')}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={isBulkDeleting}
                            onClick={() => onBulkUnfriendModeChange(false)}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                    </ToolbarActions>
                </PageToolbarRow>

                {statusDetail ? (
                    <ToolbarStatus>{statusDetail}</ToolbarStatus>
                ) : null}
            </PageToolbar>
        );
    }

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews>
                    <FriendListFilterDropdown
                        favoritesOnly={favoritesOnly}
                        isFavoritesLoaded={isFavoritesLoaded}
                        onToggleFavoritesOnly={onToggleFavoritesOnly}
                    />
                </ToolbarViews>

                <ToolbarSearch
                    value={searchQuery}
                    onValueChange={onSearchChange}
                    placeholder={t('view.friend_list.search_placeholder')}
                    trailing={
                        <FriendListSearchScopeDropdown
                            value={activeSearchFilterIds}
                            onChange={onSearchFilterChange}
                        />
                    }
                />

                <ToolbarActions>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={
                            isMutualOptOut || isMutualFetching || !currentUserId
                        }
                        onClick={onLoadMutualFriends}
                    >
                        {isMutualFetching ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <WaypointsIcon data-icon="inline-start" />
                        )}
                        {t('view.friend_list.load_mutual_friends')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!currentUserId}
                        onClick={onLoadFriendUserDetails}
                    >
                        {isLoadingUserDetails ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <UserRoundSearchIcon data-icon="inline-start" />
                        )}
                        {t('view.friend_list.load')}
                    </Button>
                    <TableColumnVisibilityMenu
                        table={table}
                        onResetLayout={onResetTableLayout}
                    />
                    <ToolbarOverflowMenu>
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                disabled={!currentUserId}
                                onClick={() => onBulkUnfriendModeChange(true)}
                            >
                                <UserMinusIcon data-icon="inline-start" />
                                {t('view.friend_list.bulk_unfriend')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </ToolbarOverflowMenu>
                </ToolbarActions>
            </PageToolbarRow>

            {statusDetail ? (
                <ToolbarStatus>{statusDetail}</ToolbarStatus>
            ) : null}
        </PageToolbar>
    );
}
