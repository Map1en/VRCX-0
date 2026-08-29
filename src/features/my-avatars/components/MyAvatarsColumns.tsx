import { CheckIcon, PersonStandingIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppColumnDef } from '@/components/data-table/appTable';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    MY_AVATAR_TAG_BADGE_CLASS_NAME,
    getMyAvatarPlatformInfo,
    resolveMyAvatarPerformanceLabel,
    resolveMyAvatarTagBadgeStyle
} from '../myAvatarsDisplay';
import type { MyAvatarRow } from '../myAvatarsTypes';
import type { MyAvatarsTableMeta } from '../useMyAvatarsTableMeta';
import {
    AvatarActionsDropdown,
    PlatformBadges,
    SortButton,
    openAvatarDetails
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
                id: 'thumbnail',
                size: 56,
                minSize: 52,
                maxSize: 64,
                accessorFn: (row) => row.thumbnailImageUrl || '',
                meta: {
                    label: t('table.playerList.avatar'),
                    disableReorder: true
                },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.playerList.avatar')}
                    </span>
                ),
                enableSorting: false,
                enableResizing: false,
                cell: ({ row }) => {
                    const avatarName =
                        row.original?.name ||
                        t('view.my_avatars.label.untitled_avatar');
                    const isActive = row.original?.id === currentAvatarId;

                    return (
                        <div className="relative w-fit">
                            <Button
                                type="button"
                                variant="ghost"
                                className="bg-muted h-6 w-10 overflow-hidden rounded-sm border p-0"
                                aria-label={t(
                                    'view.my_avatars.dynamic.open_value',
                                    { value: avatarName }
                                )}
                                onClick={() => openAvatarDetails(row.original)}
                            >
                                {row.original?.thumbnailImageUrl ? (
                                    <FadeInImage
                                        src={row.original.thumbnailImageUrl}
                                        alt=""
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                        fallback={
                                            <PersonStandingIcon
                                                aria-hidden="true"
                                                className="text-muted-foreground size-3.5"
                                            />
                                        }
                                    />
                                ) : (
                                    <PersonStandingIcon
                                        aria-hidden="true"
                                        className="text-muted-foreground size-3.5"
                                    />
                                )}
                            </Button>
                            {isActive ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span className="bg-primary text-primary-foreground ring-background absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full ring-2">
                                                <CheckIcon
                                                    aria-hidden="true"
                                                    className="size-2.5"
                                                />
                                                <span className="sr-only">
                                                    {t(
                                                        'dialog.avatar.actions.current_avatar'
                                                    )}
                                                </span>
                                            </span>
                                        }
                                    />
                                    <TooltipContent>
                                        {t(
                                            'dialog.avatar.actions.current_avatar'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                        </div>
                    );
                }
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
                            {row.original?.name ||
                                t('view.my_avatars.label.untitled_avatar')}
                        </span>
                    </Button>
                )
            },
            {
                id: 'customTags',
                size: 180,
                minSize: 120,
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
                    const visibleTags = tags.slice(0, 2);
                    const hiddenTagCount = Math.max(
                        0,
                        tags.length - visibleTags.length
                    );
                    return tags.length ? (
                        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                            {visibleTags.map((entry) => (
                                <Badge
                                    key={`${row.original.id}:${entry.tag}`}
                                    variant="secondary"
                                    className={`${MY_AVATAR_TAG_BADGE_CLASS_NAME} max-w-24 min-w-0 shrink truncate`}
                                    style={resolveMyAvatarTagBadgeStyle(entry)}
                                >
                                    {entry.tag}
                                </Badge>
                            ))}
                            {hiddenTagCount ? (
                                <Badge
                                    variant="outline"
                                    className={`${MY_AVATAR_TAG_BADGE_CLASS_NAME} shrink-0 tabular-nums`}
                                >
                                    +{hiddenTagCount}
                                </Badge>
                            ) : null}
                        </div>
                    ) : null;
                }
            },
            {
                id: 'platforms',
                size: 90,
                minSize: 78,
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
                meta: {
                    label: t('dialog.avatar.info.last_updated'),
                    stretch: true
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
                        'vrcx-0-table-header sticky top-0 right-0 z-20',
                    tableCellClassName:
                        'bg-[var(--vrcx-0-table-surface)] group-hover:bg-muted/50 sticky right-0 z-10'
                },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.import.action')}
                    </span>
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
