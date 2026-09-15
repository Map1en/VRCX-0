import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppColumnDef } from '@/components/data-table/appTable';
import { DataTableHeaderLabel } from '@/components/data-table/DataTableSortButton';
import {
    DATA_TABLE_EMPTY_VALUE,
    DATA_TABLE_METADATA_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
    DATA_TABLE_PRIMARY_CELL_CLASS_NAME,
    DATA_TABLE_STICKY_ACTION_CELL_CLASS_NAME,
    DATA_TABLE_STICKY_ACTION_HEADER_CLASS_NAME
} from '@/components/data-table/DataTableView';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    getMyAvatarPlatformInfo,
    resolveMyAvatarPerformanceLabel
} from '../myAvatarsDisplay';
import type { MyAvatarRow } from '../myAvatarsTypes';
import type { MyAvatarsTableMeta } from '../useMyAvatarsTableMeta';
import {
    AvatarActionsDropdown,
    AvatarVisibilityIndicator,
    MyAvatarNameCell,
    PlatformBadges,
    SortButton
} from './MyAvatarsViewParts';

type MyAvatarsColumnsOptions = {
    savingTagsAvatarId: string;
    tableMeta: MyAvatarsTableMeta;
    updatingAvatarId: string;
    uploadingImageAvatarId: string;
};

export function useMyAvatarsColumns({
    savingTagsAvatarId,
    tableMeta,
    updatingAvatarId,
    uploadingImageAvatarId
}: MyAvatarsColumnsOptions) {
    const { t } = useTranslation();
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';

    return useMemo<AppColumnDef<MyAvatarRow>[]>(
        () => [
            {
                id: 'name',
                size: 240,
                minSize: 160,
                accessorFn: (row) => row.name || '',
                meta: {
                    label: t('dialog.avatar.info.name'),
                    disableReorder: true,
                    tableCellClassName: DATA_TABLE_PRIMARY_CELL_CLASS_NAME
                },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.name')}
                    />
                ),
                cell: ({ row }) => (
                    <MyAvatarNameCell
                        avatar={row.original}
                        isPublic={row.original?.releaseStatus === 'public'}
                        publicLabel={t('dialog.avatar.tags.public')}
                    />
                )
            },
            {
                id: 'platforms',
                size: 90,
                minSize: 78,
                accessorFn: (row) => (row.unityPackages?.length ? 1 : 0),
                meta: { label: t('dialog.avatar.info.platform') },
                header: () => (
                    <DataTableHeaderLabel>
                        {t('dialog.avatar.info.platform')}
                    </DataTableHeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }) => (
                    <PlatformBadges
                        unityPackages={row.original?.unityPackages}
                    />
                )
            },
            {
                id: 'visibility',
                size: 96,
                minSize: 82,
                accessorFn: (row) => row.releaseStatus || '',
                meta: { label: t('dialog.avatar.info.visibility') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.visibility')}
                    />
                ),
                cell: ({ row }) => {
                    const isPublic = row.original?.releaseStatus === 'public';
                    return (
                        <AvatarVisibilityIndicator
                            isPublic={isPublic}
                            label={t(
                                isPublic
                                    ? 'dialog.avatar.tags.public'
                                    : 'dialog.avatar.tags.private'
                            )}
                        />
                    );
                }
            },
            {
                id: 'timeSpent',
                size: 116,
                minSize: 104,
                accessorFn: (row) => Number(row.$timeSpent) || 0,
                meta: {
                    label: t('dialog.avatar.info.time_spent'),
                    tableHeadClassName: DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
                    tableCellClassName: DATA_TABLE_NUMERIC_CELL_CLASS_NAME
                },
                header: ({ column }) => (
                    <div className="flex w-full min-w-0 justify-end overflow-hidden">
                        <SortButton
                            column={column}
                            label={t('dialog.avatar.info.time_spent')}
                            descFirst
                        />
                    </div>
                ),
                cell: ({ row }) => (
                    <span className="block">
                        {row.original?.$timeSpent
                            ? timeToText(row.original.$timeSpent)
                            : DATA_TABLE_EMPTY_VALUE}
                    </span>
                )
            },
            {
                id: 'version',
                size: 80,
                minSize: 64,
                accessorFn: (row) => Number(row.version) || 0,
                meta: {
                    label: t('dialog.avatar.info.version'),
                    tableHeadClassName: DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
                    tableCellClassName: DATA_TABLE_NUMERIC_CELL_CLASS_NAME
                },
                header: ({ column }) => (
                    <div className="flex w-full min-w-0 justify-end overflow-hidden">
                        <SortButton
                            column={column}
                            label={t('dialog.avatar.info.version')}
                            descFirst
                        />
                    </div>
                ),
                cell: ({ row }) => (
                    <span className="block">
                        {row.original?.version ?? DATA_TABLE_EMPTY_VALUE}
                    </span>
                )
            },
            {
                id: 'pcPerf',
                size: 140,
                minSize: 110,
                accessorFn: (row) =>
                    getMyAvatarPlatformInfo(row)?.pc?.performanceRating || '',
                meta: { label: t('dialog.avatar.info.pc_performance') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.pc_performance')}
                    />
                ),
                cell: ({ row }) => {
                    const platformInfo = getMyAvatarPlatformInfo(row.original);
                    return (
                        <span>
                            {resolveMyAvatarPerformanceLabel(
                                platformInfo?.pc?.performanceRating
                            )}
                        </span>
                    );
                }
            },
            {
                id: 'androidPerf',
                size: 160,
                minSize: 130,
                accessorFn: (row) =>
                    getMyAvatarPlatformInfo(row)?.android?.performanceRating ||
                    '',
                meta: { label: t('dialog.avatar.info.android_performance') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.android_performance')}
                    />
                ),
                cell: ({ row }) => {
                    const platformInfo = getMyAvatarPlatformInfo(row.original);
                    return (
                        <span>
                            {resolveMyAvatarPerformanceLabel(
                                platformInfo?.android?.performanceRating
                            )}
                        </span>
                    );
                }
            },
            {
                id: 'iosPerf',
                size: 140,
                minSize: 110,
                accessorFn: (row) =>
                    getMyAvatarPlatformInfo(row)?.ios?.performanceRating || '',
                meta: { label: t('dialog.avatar.info.ios_performance') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.ios_performance')}
                    />
                ),
                cell: ({ row }) => {
                    const platformInfo = getMyAvatarPlatformInfo(row.original);
                    return (
                        <span>
                            {resolveMyAvatarPerformanceLabel(
                                platformInfo?.ios?.performanceRating
                            )}
                        </span>
                    );
                }
            },
            {
                id: 'updated_at',
                size: 170,
                minSize: 130,
                accessorFn: (row) => row.updated_at || '',
                meta: {
                    label: t('dialog.avatar.info.last_updated'),
                    stretch: true,
                    tableCellClassName: DATA_TABLE_METADATA_CELL_CLASS_NAME
                },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.last_updated')}
                        descFirst
                    />
                ),
                cell: ({ row }) => (
                    <span>
                        {row.original?.updated_at
                            ? formatDateFilter(row.original.updated_at, 'long')
                            : DATA_TABLE_EMPTY_VALUE}
                    </span>
                )
            },
            {
                id: 'created_at',
                size: 170,
                minSize: 130,
                accessorFn: (row) => row.created_at || '',
                meta: {
                    label: t('dialog.avatar.info.created_at'),
                    tableCellClassName: DATA_TABLE_METADATA_CELL_CLASS_NAME
                },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.created_at')}
                        descFirst
                    />
                ),
                cell: ({ row }) => (
                    <span>
                        {row.original?.created_at
                            ? formatDateFilter(row.original.created_at, 'long')
                            : DATA_TABLE_EMPTY_VALUE}
                    </span>
                )
            },
            {
                id: 'actions',
                size: 80,
                minSize: 80,
                maxSize: 80,
                enableSorting: false,
                enableResizing: false,
                meta: {
                    label: t('table.import.action'),
                    disableReorder: true,
                    disableVisibilityToggle: true,
                    tableHeadClassName:
                        DATA_TABLE_STICKY_ACTION_HEADER_CLASS_NAME,
                    tableCellClassName: DATA_TABLE_STICKY_ACTION_CELL_CLASS_NAME
                },
                header: () => (
                    <DataTableHeaderLabel>
                        {t('table.import.action')}
                    </DataTableHeaderLabel>
                ),
                cell: ({ row }) => {
                    const isUpdating =
                        updatingAvatarId === row.original?.id ||
                        savingTagsAvatarId === row.original?.id ||
                        uploadingImageAvatarId === row.original?.id;
                    return (
                        <AvatarActionsDropdown
                            avatar={row.original}
                            isActive={row.original?.id === currentAvatarId}
                            isUpdating={isUpdating}
                            onAction={tableMeta.onAvatarAction}
                        />
                    );
                }
            }
        ],
        [
            currentAvatarId,
            savingTagsAvatarId,
            tableMeta,
            t,
            updatingAvatarId,
            uploadingImageAvatarId
        ]
    );
}
