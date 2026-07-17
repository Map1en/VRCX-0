import type { ColumnDef } from '@tanstack/react-table';
import { CheckIcon, PersonStandingIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    MY_AVATAR_TAG_BADGE_CLASS_NAME,
    getMyAvatarPlatformInfo,
    resolveMyAvatarPerformanceLabel,
    resolveMyAvatarTagBadgeStyle
} from '../myAvatarsDisplay';
import type {
    MyAvatarAction,
    MyAvatarActionHandler,
    MyAvatarRow
} from '../myAvatarsTypes';
import {
    AvatarActionsDropdown,
    PlatformBadges,
    SortButton,
    openAvatarDetails
} from './MyAvatarsViewParts';

type MyAvatarsColumnsOptions = {
    onAvatarAction: MyAvatarActionHandler;
    savingTagsAvatarId: string;
    updatingAvatarId: string;
    uploadingImageAvatarId: string;
};

export function useMyAvatarsColumns({
    onAvatarAction,
    savingTagsAvatarId,
    updatingAvatarId,
    uploadingImageAvatarId
}: MyAvatarsColumnsOptions) {
    const { t } = useTranslation();
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';

    return useMemo<ColumnDef<MyAvatarRow>[]>(
        () => [
            {
                id: 'active',
                size: 32,
                minSize: 32,
                maxSize: 36,
                accessorFn: (row) => (row.id === currentAvatarId ? 1 : 0),
                header: (): ReactNode => null,
                enableResizing: false,
                cell: ({ row }) =>
                    row.original?.id === currentAvatarId ? (
                        <CheckIcon className="text-primary size-3.5" />
                    ) : (
                        <span className="block size-3.5" />
                    )
            },
            {
                id: 'thumbnail',
                size: 56,
                minSize: 52,
                maxSize: 72,
                accessorFn: (row) => row.thumbnailImageUrl || '',
                header: (): ReactNode => null,
                enableSorting: false,
                enableResizing: false,
                cell: ({ row }) =>
                    row.original?.thumbnailImageUrl ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-6 w-10 p-0"
                            onClick={() => openAvatarDetails(row.original)}
                        >
                            <FadeInImage
                                src={row.original.thumbnailImageUrl}
                                alt={
                                    row.original?.name ||
                                    t('view.my_avatars.label.avatar')
                                }
                                className="h-6 w-10 rounded-sm object-cover"
                                loading="lazy"
                                fallback={
                                    <PersonStandingIcon data-icon="inline-start" />
                                }
                            />
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-muted-foreground h-6 w-10 p-0"
                            onClick={() => openAvatarDetails(row.original)}
                        >
                            <PersonStandingIcon data-icon="inline-start" />
                        </Button>
                    )
            },
            {
                id: 'name',
                size: 240,
                minSize: 160,
                accessorFn: (row) => row.name || '',
                meta: { label: t('dialog.avatar.info.name') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.name')}
                    />
                ),
                cell: ({ row }) => (
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-primary h-auto max-w-full p-0 text-left text-sm font-medium"
                        onClick={() => openAvatarDetails(row.original)}
                    >
                        <span className="truncate">
                            {row.original?.name || ''}
                        </span>
                    </Button>
                )
            },
            {
                id: 'customTags',
                size: 220,
                minSize: 140,
                accessorFn: (row) =>
                    (row?.$tags || []).map((entry) => entry.tag).join(', '),
                meta: { label: t('dialog.avatar.info.tags') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.tags')}
                    />
                ),
                cell: ({ row }) => {
                    const tags = row.original.$tags || [];
                    return tags.length ? (
                        <div className="flex max-h-7 flex-wrap gap-1 overflow-hidden">
                            {tags.map((entry) => (
                                <Badge
                                    key={`${row.original.id}:${entry.tag}`}
                                    variant="secondary"
                                    className={MY_AVATAR_TAG_BADGE_CLASS_NAME}
                                    style={resolveMyAvatarTagBadgeStyle(entry)}
                                >
                                    {entry.tag}
                                </Badge>
                            ))}
                        </div>
                    ) : null;
                }
            },
            {
                id: 'platforms',
                size: 110,
                minSize: 90,
                accessorFn: (row) => (row.unityPackages?.length ? 1 : 0),
                meta: { label: t('dialog.avatar.info.platform') },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('dialog.avatar.info.platform')}
                    </span>
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
                size: 110,
                minSize: 90,
                accessorFn: (row) => row.releaseStatus || '',
                meta: { label: t('dialog.avatar.info.visibility') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('dialog.avatar.info.visibility')}
                    />
                ),
                cell: ({ row }) => (
                    <Badge variant="outline">
                        {row.original?.releaseStatus === 'public'
                            ? t('dialog.avatar.tags.public')
                            : t('dialog.avatar.tags.private')}
                    </Badge>
                )
            },
            {
                id: 'timeSpent',
                size: 116,
                minSize: 104,
                accessorFn: (row) => Number(row.$timeSpent) || 0,
                meta: {
                    label: t('dialog.avatar.info.time_spent'),
                    tableHeadClassName: 'text-right',
                    tableCellClassName: 'text-right tabular-nums'
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
                            : '-'}
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
                    tableHeadClassName: 'text-right',
                    tableCellClassName: 'text-right tabular-nums'
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
                        {row.original?.version ?? '-'}
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
                meta: { label: t('dialog.avatar.info.last_updated') },
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
                            : '-'}
                    </span>
                )
            },
            {
                id: 'created_at',
                size: 170,
                minSize: 130,
                accessorFn: (row) => row.created_at || '',
                meta: { label: t('dialog.avatar.info.created_at') },
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
                            : '-'}
                    </span>
                )
            },
            {
                id: 'actions',
                size: 48,
                minSize: 48,
                maxSize: 56,
                enableSorting: false,
                enableResizing: false,
                meta: {
                    label: t('table.import.action'),
                    disableReorder: true,
                    disableVisibilityToggle: true,
                    tableHeadClassName:
                        'bg-background sticky right-0 z-20 border-l',
                    tableCellClassName:
                        'bg-background group-hover:bg-muted/50 sticky right-0 z-10 border-l'
                },
                header: (): ReactNode => null,
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
                            onAction={(
                                action: MyAvatarAction,
                                avatar: MyAvatarRow
                            ) => {
                                onAvatarAction(action, avatar);
                            }}
                        />
                    );
                }
            }
        ],
        [
            currentAvatarId,
            onAvatarAction,
            savingTagsAvatarId,
            t,
            updatingAvatarId,
            uploadingImageAvatarId
        ]
    );
}
