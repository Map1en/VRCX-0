import {
    CheckIcon,
    ImageIcon
} from 'lucide-react';

import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    getMyAvatarPlatformInfo,
    resolveMyAvatarPerformanceLabel,
    resolveMyAvatarTagBadgeStyle
} from '../myAvatarsDisplay.js';
import {
    AvatarActionsDropdown,
    PlatformBadges,
    SortButton,
    openAvatarDetails
} from './MyAvatarsViewParts.jsx';

export function buildMyAvatarsColumns({
    currentAvatarId,
    onAvatarAction,
    savingTagsAvatarId,
    t,
    updatingAvatarId,
    uploadingImageAvatarId
}) {
    return [
        {
            id: 'active',
            accessorFn: (row) => (row?.id === currentAvatarId ? 1 : 0),
            header: () => null,
            cell: ({ row }) =>
                row.original?.id === currentAvatarId ? (
                    <CheckIcon className="text-primary size-4" />
                ) : (
                    <span className="block size-4" />
                )
        },
        {
            id: 'thumbnail',
            accessorFn: (row) => row?.thumbnailImageUrl || '',
            header: () => null,
            enableSorting: false,
            cell: ({ row }) =>
                row.original?.thumbnailImageUrl ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-auto p-0"
                        onClick={() => openAvatarDetails(row.original)}
                    >
                        <img
                            src={row.original.thumbnailImageUrl}
                            alt={
                                row.original?.name ||
                                t('view.my_avatars.generated.avatar')
                            }
                            className="h-10 w-16 rounded-sm object-cover"
                            loading="lazy"
                        />
                    </Button>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        className="text-muted-foreground h-10 w-16 p-0"
                        onClick={() => openAvatarDetails(row.original)}
                    >
                        <ImageIcon data-icon="inline-start" />
                    </Button>
                )
        },
        {
            id: 'name',
            accessorFn: (row) => row?.name || '',
            meta: { label: t('dialog.avatar.info.name') },
            header: ({ column }) => (
                <SortButton column={column} label={t('dialog.avatar.info.name')} />
            ),
            cell: ({ row }) => (
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-primary h-auto p-0 text-left font-medium"
                    onClick={() => openAvatarDetails(row.original)}
                >
                    {row.original?.name || ''}
                </Button>
            )
        },
        {
            id: 'customTags',
            accessorFn: (row) =>
                (row?.$tags || []).map((entry) => entry.tag).join(', '),
            meta: { label: t('dialog.avatar.info.tags') },
            header: ({ column }) => (
                <SortButton column={column} label={t('dialog.avatar.info.tags')} />
            ),
            cell: ({ row }) =>
                (row.original?.$tags || []).length ? (
                    <div className="flex flex-wrap gap-1">
                        {row.original.$tags.map((entry) => (
                            <Badge
                                key={`${row.original.id}:${entry.tag}`}
                                variant="secondary"
                                style={resolveMyAvatarTagBadgeStyle(entry)}
                            >
                                {entry.tag}
                            </Badge>
                        ))}
                    </div>
                ) : null
        },
        {
            id: 'platforms',
            accessorFn: (row) => (row?.unityPackages?.length ? 1 : 0),
            meta: { label: t('dialog.avatar.info.platform') },
            header: () => (
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t('dialog.avatar.info.platform')}
                </span>
            ),
            enableSorting: false,
            cell: ({ row }) => (
                <PlatformBadges unityPackages={row.original?.unityPackages} />
            )
        },
        {
            id: 'visibility',
            accessorFn: (row) => row?.releaseStatus || '',
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
            accessorFn: (row) => Number(row?.$timeSpent) || 0,
            meta: { label: t('dialog.avatar.info.time_spent') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('dialog.avatar.info.time_spent')}
                    descFirst
                />
            ),
            cell: ({ row }) => (
                <span>
                    {row.original?.$timeSpent
                        ? timeToText(row.original.$timeSpent)
                        : '-'}
                </span>
            )
        },
        {
            id: 'version',
            accessorFn: (row) => Number(row?.version) || 0,
            meta: { label: t('dialog.avatar.info.version') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('dialog.avatar.info.version')}
                    descFirst
                />
            ),
            cell: ({ row }) => <span>{row.original?.version ?? '-'}</span>
        },
        {
            id: 'pcPerf',
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
            accessorFn: (row) =>
                getMyAvatarPlatformInfo(row)?.android?.performanceRating || '',
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
            accessorFn: (row) => row?.updated_at || '',
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
            accessorFn: (row) => row?.created_at || '',
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
            enableSorting: false,
            meta: { label: t('table.import.action') },
            header: () => null,
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
                        onAction={(action, avatar) =>
                            void onAvatarAction(action, avatar)
                        }
                    />
                );
            }
        }
    ];
}
