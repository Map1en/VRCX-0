import { ArrowUpDownIcon, LayoutGridIcon, ListIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppTable } from '@/components/data-table/appTable';
import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import { useHasLicensedAvatars } from '@/components/economy/useHasLicensedAvatars';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarSearch,
    ToolbarSegmented,
    ToolbarViews,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import type {
    MyAvatarsGridDensity,
    MyAvatarsLoadStatus,
    MyAvatarRow,
    MyAvatarsPlatformFilter,
    MyAvatarsReleaseStatusFilter,
    MyAvatarsSource,
    MyAvatarsViewMode
} from '../myAvatarsTypes';
import { LocalTestAvatarsButton } from './LocalTestAvatarsDialog';
import { GridSettingsMenu, MyAvatarFilterPopover } from './MyAvatarsViewParts';

type MyAvatarsToolbarProps = {
    source: MyAvatarsSource;
    onSourceChange: (value: MyAvatarsSource) => void;
    viewMode: MyAvatarsViewMode;
    activeFilterCount: number;
    allTags: string[];
    releaseStatusFilter: MyAvatarsReleaseStatusFilter;
    platformFilter: MyAvatarsPlatformFilter;
    tagFilters: Set<string>;
    loadStatus: MyAvatarsLoadStatus;
    searchQuery: string;
    gridDensity: MyAvatarsGridDensity;
    table: AppTable<MyAvatarRow>;
    onViewModeChange: (value: MyAvatarsViewMode) => void;
    onReleaseStatusChange: (value: MyAvatarsReleaseStatusFilter) => void;
    onPlatformChange: (value: MyAvatarsPlatformFilter) => void;
    onTagFiltersChange: Dispatch<SetStateAction<Set<string>>>;
    onClearFilters: () => void;
    onSearchChange: (value: string) => void;
    onGridDensityChange: (value: MyAvatarsGridDensity) => void;
    onRefresh: () => void;
};

const GRID_SORT_COLUMNS = [
    { id: 'name', labelKey: 'dialog.avatar.info.name', desc: false },
    { id: 'timeSpent', labelKey: 'dialog.avatar.info.time_spent', desc: true },
    {
        id: 'updated_at',
        labelKey: 'dialog.avatar.info.last_updated',
        desc: true
    },
    { id: 'created_at', labelKey: 'dialog.avatar.info.created_at', desc: true }
] as const;

function MyAvatarsGridSortSelect({ table }: { table: AppTable<MyAvatarRow> }) {
    const { t } = useTranslation();
    const currentId = table.state.sorting?.[0]?.id ?? '';
    const items = GRID_SORT_COLUMNS.map((column) => ({
        value: column.id,
        label: t(column.labelKey)
    }));
    const value = items.some((item) => item.value === currentId)
        ? currentId
        : null;

    return (
        <Select
            value={value}
            items={items}
            onValueChange={(next) => {
                const column = GRID_SORT_COLUMNS.find(
                    (entry) => entry.id === next
                );
                if (column) {
                    table.setSorting([{ id: column.id, desc: column.desc }]);
                }
            }}
        >
            <SelectTrigger
                className="max-w-48 min-w-36 shrink-0"
                aria-label={t('view.my_avatars.label.sort_by')}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <ArrowUpDownIcon className="text-muted-foreground size-4 shrink-0" />
                    <SelectValue
                        placeholder={t('view.my_avatars.label.sort_by')}
                    />
                </span>
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                            {item.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

export function MyAvatarsToolbar({
    source,
    onSourceChange,
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
    onViewModeChange,
    onReleaseStatusChange,
    onPlatformChange,
    onTagFiltersChange,
    onClearFilters,
    onSearchChange,
    onGridDensityChange,
    onRefresh
}: MyAvatarsToolbarProps) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const viewModeOptions: ToolbarSegmentOption<MyAvatarsViewMode>[] = [
        {
            value: 'grid',
            label: t('view.my_avatars.action.show_avatar_grid'),
            icon: LayoutGridIcon
        },
        {
            value: 'table',
            label: t('view.my_avatars.action.show_avatar_table'),
            icon: ListIcon
        }
    ];

    const hasLicensedAvatars = useHasLicensedAvatars(true);
    const sourceOptions: ToolbarSegmentOption<MyAvatarsSource>[] = [
        { value: 'own', label: t('view.my_avatars.source.own') },
        { value: 'licensed', label: t('view.my_avatars.source.licensed') }
    ];

    return (
        <PageToolbar>
            <PageToolbarRow>
                <ToolbarViews>
                    {hasLicensedAvatars || source === 'licensed' ? (
                        <ToolbarSegmented
                            value={source}
                            onValueChange={onSourceChange}
                            options={sourceOptions}
                        />
                    ) : null}
                    <ToolbarSegmented
                        iconOnly
                        value={viewMode}
                        onValueChange={onViewModeChange}
                        options={viewModeOptions}
                    />
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
                    {viewMode === 'grid' ? (
                        <MyAvatarsGridSortSelect table={table} />
                    ) : null}
                </ToolbarViews>

                <LocalTestAvatarsButton />
                <ToolbarSearch
                    value={searchQuery}
                    onValueChange={onSearchChange}
                />

                <ToolbarActions>
                    <ToolbarRefreshButton
                        onRefresh={onRefresh}
                        loading={loadStatus === 'running'}
                        disabled={!currentUserId}
                        label={t(
                            'view.my_avatars.action.refresh_avatar_inventory'
                        )}
                    />
                    {viewMode === 'grid' ? (
                        <GridSettingsMenu
                            gridDensity={gridDensity}
                            onGridDensityChange={onGridDensityChange}
                        />
                    ) : null}
                    {viewMode === 'table' ? (
                        <TableColumnVisibilityMenu table={table} />
                    ) : null}
                </ToolbarActions>
            </PageToolbarRow>
        </PageToolbar>
    );
}
