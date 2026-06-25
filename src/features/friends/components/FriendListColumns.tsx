import { EyeOffIcon, UserIcon, UserMinusIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import {
    getNameColour,
    openExternalLink,
    userImage
} from '@/services/entityMediaService';
import { getFaviconUrl } from '@/shared/utils/urlUtils';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageCodeLabel,
    languageTooltipLabel,
    resolveFriendLanguageRows,
    resolveFriendStatusMeta as resolveStatusMeta
} from '../friendListDisplay';
import {
    friendNumberForSort,
    normalizeFriendListId as normalizeId
} from '../friendListRows';
import { SortButton } from './FriendListViewParts';

export function useFriendListColumns({
    bulkUnfriendMode,
    currentUserId,
    deletingFriendIds,
    onConfirmDeleteFriend,
    onToggleSelectedFriend,
    randomUserColours,
    selectedFriendIds
}: any) {
    const { t } = useTranslation();
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    return useMemo(
        () => [
            {
                id: 'leftSpacer',
                size: 20,
                enableSorting: false,
                enableResizing: false,
                header: (): ReactNode => null,
                cell: (): ReactNode => null
            },
            {
                id: 'bulkSelect',
                size: 55,
                enableSorting: false,
                header: (): ReactNode => null,
                cell: ({ row }: any) => {
                    const friendId = normalizeId(row.original?.id);
                    const friendLabel = row.original?.displayName || friendId;

                    return (
                        <div
                            className="flex items-center justify-center"
                            onClick={(event: any) => event.stopPropagation()}
                        >
                            <Checkbox
                                checked={selectedFriendIds.has(friendId)}
                                disabled={
                                    !bulkUnfriendMode ||
                                    deletingFriendIds.has(friendId)
                                }
                                aria-label={`${t('common.actions.select')} ${friendLabel}`}
                                onCheckedChange={() =>
                                    onToggleSelectedFriend(friendId)
                                }
                            />
                        </div>
                    );
                }
            },
            {
                id: 'friendNumber',
                size: 100,
                meta: { label: t('table.friendList.no') },
                accessorFn: (row: any) =>
                    Number.parseInt(
                        row?.$friendNumber ?? row?.friendNumber ?? 0,
                        10
                    ) || 0,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.no')}
                        descFirst
                    />
                ),
                cell: ({ row }: any) => {
                    const friendNumber =
                        Number.parseInt(
                            row.original?.$friendNumber ??
                                row.original?.friendNumber ??
                                row.getValue('friendNumber') ??
                                0,
                            10
                        ) || row.index + 1;
                    return <span>{friendNumber}</span>;
                }
            },
            {
                id: 'avatar',
                size: 90,
                meta: { label: t('table.friendList.avatar') },
                accessorFn: (row: any) => userImage(row, true),
                enableSorting: false,
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.avatar')}
                    </span>
                ),
                cell: ({ row }: any) => {
                    const imageUrl = userImage(row.original, true);
                    return imageUrl ? (
                        <img
                            src={imageUrl}
                            alt={
                                row.original?.displayName ||
                                row.original?.id ||
                                t('table.friendList.avatar')
                            }
                            loading="lazy"
                            className="size-6 rounded-full object-cover"
                        />
                    ) : (
                        <div className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full">
                            <UserIcon className="size-3" />
                        </div>
                    );
                }
            },
            {
                id: 'displayName',
                size: 200,
                meta: { label: t('table.friendList.displayName') },
                accessorFn: (row: any) => row?.displayName || '',
                enableSorting: false,
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.displayName')}
                    </span>
                ),
                cell: ({ row }: any) => {
                    const nameStyle =
                        randomUserColours && row.original?.id
                            ? {
                                  color: getNameColour(
                                      row.original.id,
                                      isDarkMode
                                  )
                              }
                            : undefined;
                    return (
                        <span className="name truncate" style={nameStyle}>
                            {row.original?.displayName || ''}
                        </span>
                    );
                }
            },
            {
                id: 'rank',
                size: 140,
                meta: { label: t('table.friendList.rank') },
                accessorFn: (row: any) =>
                    Number.parseInt(row?.$trustSortNum ?? 0, 10) || 0,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.rank')}
                    />
                ),
                cell: ({ row }: any) => (
                    <span
                        className={cn(
                            'text-sm',
                            row.original?.$trustClass || ''
                        )}
                    >
                        {row.original?.$trustLevel || ''}
                    </span>
                )
            },
            {
                id: 'status',
                size: 220,
                meta: { label: t('table.friendList.status') },
                accessorFn: (row: any) => resolveStatusMeta(row).sortRank,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.status')}
                    />
                ),
                sortingFn: (rowA: any, rowB: any) => {
                    const left = resolveStatusMeta(rowA.original);
                    const right = resolveStatusMeta(rowB.original);
                    if (left.sortRank !== right.sortRank) {
                        return left.sortRank - right.sortRank;
                    }
                    return (
                        friendNumberForSort(rowA.original) -
                        friendNumberForSort(rowB.original)
                    );
                },
                cell: ({ row }: any) => {
                    const status = resolveStatusMeta(row.original);
                    return (
                        <span className="flex min-w-0 items-center gap-2">
                            {status.showIndicator ? (
                                <i className={status.indicatorClassName} />
                            ) : null}
                            {status.label ? (
                                <span className="truncate">{status.label}</span>
                            ) : null}
                        </span>
                    );
                }
            },
            {
                id: 'language',
                accessorFn: (row: any) =>
                    resolveFriendLanguageRows(row)
                        .map((entry: any) => entry?.value || '')
                        .join('\u0000'),
                size: 160,
                meta: { label: t('table.friendList.language') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.language')}
                    />
                ),
                cell: ({ row }: any) => {
                    const languages = resolveFriendLanguageRows(row.original);
                    return languages.length ? (
                        <div className="flex flex-wrap items-center gap-1">
                            {languages.map((entry: any) => {
                                const key = entry?.key || entry?.value || '';
                                const code = languageCodeLabel(key);
                                const tooltipLabel = languageTooltipLabel(
                                    entry,
                                    code
                                );
                                if (!code) {
                                    return null;
                                }
                                return (
                                    <Tooltip
                                        key={`${key}:${entry?.value || ''}`}
                                    >
                                        <TooltipTrigger asChild>
                                            <span
                                                className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold"
                                                aria-label={tooltipLabel}
                                            >
                                                {code}
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            {tooltipLabel}
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    ) : null;
                }
            },
            {
                id: 'bioLink',
                accessorFn: (row: any) =>
                    Array.isArray(row?.bioLinks)
                        ? row.bioLinks.filter(Boolean).join('\u0000')
                        : '',
                size: 140,
                enableSorting: false,
                meta: { label: t('table.friendList.bioLink') },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.bioLink')}
                    </span>
                ),
                cell: ({ row }: any) => {
                    const links = Array.isArray(row.original?.bioLinks)
                        ? row.original.bioLinks.filter(Boolean)
                        : [];
                    return links.length ? (
                        <div className="flex items-center gap-1">
                            {links.map((link: any) => (
                                <Tooltip key={link}>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            className="size-7"
                                            onClick={(event: any) => {
                                                event.stopPropagation();
                                                openExternalLink(link);
                                            }}
                                        >
                                            <img
                                                src={getFaviconUrl(link)}
                                                alt=""
                                                className="size-4"
                                                loading="lazy"
                                            />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{link}</TooltipContent>
                                </Tooltip>
                            ))}
                        </div>
                    ) : null;
                }
            },
            {
                id: 'joinCount',
                accessorFn: (row: any) =>
                    Number.parseInt(row?.$joinCount ?? 0, 10) || 0,
                size: 120,
                meta: { label: t('table.friendList.joinCount') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.joinCount')}
                    />
                ),
                cell: ({ row }: any) => (
                    <span className="block text-right">
                        {row.original?.$joinCount || ''}
                    </span>
                )
            },
            {
                id: 'timeTogether',
                accessorFn: (row: any) =>
                    Number.parseInt(row?.$timeSpent ?? 0, 10) || 0,
                size: 150,
                meta: { label: t('table.friendList.timeTogether') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.timeTogether')}
                    />
                ),
                cell: ({ row }: any) => {
                    const timeSpent =
                        Number.parseInt(row.original?.$timeSpent ?? 0, 10) || 0;
                    return (
                        <span className="block text-right">
                            {timeSpent ? timeToText(timeSpent) : ''}
                        </span>
                    );
                }
            },
            {
                id: 'lastSeen',
                accessorFn: (row: any) => row?.$lastSeen || '',
                size: 180,
                meta: { label: t('table.friendList.lastSeen') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastSeen')}
                    />
                ),
                cell: ({ row }: any) => {
                    const text = formatDateFilter(
                        row.original?.$lastSeen,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'mutualFriends',
                accessorFn: (row: any) =>
                    Number.parseInt(row?.$mutualCount ?? 0, 10) || 0,
                size: 140,
                meta: { label: t('table.friendList.mutualFriends') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.mutualFriends')}
                    />
                ),
                cell: ({ row }: any) => {
                    const count =
                        Number.parseInt(row.original?.$mutualCount ?? 0, 10) ||
                        0;
                    const optedOut = Boolean(row.original?.$mutualOptedOut);
                    return count || optedOut ? (
                        <span className="flex items-center justify-end gap-1">
                            {count || ''}
                            {optedOut ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="inline-flex">
                                            <EyeOffIcon className="text-muted-foreground size-3.5" />
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        {t('table.friendList.mutualOptedOut')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                        </span>
                    ) : null;
                }
            },
            {
                id: 'lastActivity',
                accessorFn: (row: any) => row?.last_activity || '',
                size: 200,
                meta: { label: t('table.friendList.lastActivity') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastActivity')}
                    />
                ),
                cell: ({ row }: any) => {
                    const text = formatDateFilter(
                        row.original?.last_activity,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'lastLogin',
                accessorFn: (row: any) => row?.last_login || '',
                size: 200,
                meta: { label: t('table.friendList.lastLogin') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastLogin')}
                    />
                ),
                cell: ({ row }: any) => {
                    const text = formatDateFilter(
                        row.original?.last_login,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'dateJoined',
                accessorFn: (row: any) => row?.date_joined || '',
                size: 140,
                meta: { label: t('table.friendList.dateJoined') },
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.dateJoined')}
                    />
                ),
                cell: ({ row }: any) => (
                    <span>{row.original?.date_joined || ''}</span>
                )
            },
            {
                id: 'unfriend',
                size: 100,
                enableSorting: false,
                meta: { label: t('table.friendList.unfriend') },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.unfriend')}
                    </span>
                ),
                cell: ({ row }: any) => {
                    const friendId = normalizeId(row.original?.id);
                    return (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive size-7"
                            aria-label={t('table.friendList.unfriend')}
                            disabled={
                                !currentUserId ||
                                deletingFriendIds.has(friendId)
                            }
                            onClick={(event: any) => {
                                event.stopPropagation();
                                onConfirmDeleteFriend(row.original);
                            }}
                        >
                            <UserMinusIcon data-icon="inline-start" />
                        </Button>
                    );
                }
            }
        ],
        [
            bulkUnfriendMode,
            currentUserId,
            deletingFriendIds,
            isDarkMode,
            onConfirmDeleteFriend,
            onToggleSelectedFriend,
            randomUserColours,
            selectedFriendIds,
            t
        ]
    );
}
