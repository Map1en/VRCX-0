import {
    EyeOffIcon,
    UserIcon,
    UserMinusIcon
} from 'lucide-react';

import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import {
    getNameColour,
    openExternalLink,
    userImage
} from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageFlagLabel,
    languageTooltipLabel,
    resolveFriendStatusMeta as resolveStatusMeta
} from '../friendListDisplay.js';
import {
    friendNumberForSort,
    normalizeFriendListId as normalizeId
} from '../friendListRows.js';
import { SortButton } from './FriendListViewParts.jsx';

export function buildFriendListColumns({
    bulkUnfriendMode,
    currentUserId,
    deletingFriendIds,
    onConfirmDeleteFriend,
    onToggleSelectedFriend,
    randomUserColours,
    selectedFriendIds,
    t
}) {
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    return [
        {
            id: 'leftSpacer',
            size: 20,
            enableSorting: false,
            enableResizing: false,
            header: () => null,
            cell: () => null
        },
        {
            id: 'bulkSelect',
            size: 55,
            enableSorting: false,
            header: () => null,
            cell: ({ row }) => {
                const friendId = normalizeId(row.original?.id);
                const friendLabel = row.original?.displayName || friendId;

                return (
                    <div
                        className="flex items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
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
            accessorFn: (row) =>
                Number.parseInt(row?.$friendNumber ?? row?.friendNumber ?? 0, 10) ||
                0,
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.no')}
                    descFirst
                />
            ),
            cell: ({ row }) => {
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
            accessorFn: (row) => userImage(row, true),
            enableSorting: false,
            header: () => (
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t('table.friendList.avatar')}
                </span>
            ),
            cell: ({ row }) => {
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
            accessorFn: (row) => row?.displayName || '',
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.displayName')}
                />
            ),
            sortingFn: (rowA, rowB) =>
                String(rowA.original?.displayName || '').localeCompare(
                    String(rowB.original?.displayName || ''),
                    undefined,
                    { sensitivity: 'base' }
                ),
            cell: ({ row }) => {
                const nameStyle =
                    randomUserColours && row.original?.id
                        ? {
                              color: getNameColour(row.original.id, isDarkMode)
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
            accessorFn: (row) => Number.parseInt(row?.$trustSortNum ?? 0, 10) || 0,
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.rank')}
                />
            ),
            cell: ({ row }) => (
                <span className={cn('text-sm', row.original?.$trustClass || '')}>
                    {row.original?.$trustLevel || ''}
                </span>
            )
        },
        {
            id: 'status',
            size: 220,
            meta: { label: t('table.friendList.status') },
            accessorFn: (row) => resolveStatusMeta(row).sortRank,
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.status')}
                />
            ),
            sortingFn: (rowA, rowB) => {
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
            cell: ({ row }) => {
                const status = resolveStatusMeta(row.original);
                return (
                    <span className="flex min-w-0 items-center gap-2">
                        {status.showIndicator ? (
                            <i className={status.indicatorClassName} />
                        ) : null}
                        <span className="truncate">{status.label}</span>
                    </span>
                );
            }
        },
        {
            id: 'language',
            accessorFn: (row) =>
                Array.isArray(row?.$languages)
                    ? row.$languages.map((entry) => entry?.value || '').join('\u0000')
                    : '',
            size: 160,
            meta: { label: t('table.friendList.language') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.language')}
                />
            ),
            cell: ({ row }) => {
                const languages = Array.isArray(row.original?.$languages)
                    ? row.original.$languages
                    : [];
                return languages.length ? (
                    <div className="flex items-center">
                        {languages.map((entry) => {
                            const tooltipLabel = languageTooltipLabel(entry);
                            return (
                                <Tooltip key={`${entry?.key}-${entry?.value}`}>
                                    <TooltipTrigger asChild>
                                        <span
                                            className="mr-1 inline-flex min-w-5 items-center justify-center text-sm leading-none"
                                            title={tooltipLabel}
                                            aria-label={tooltipLabel}
                                        >
                                            {languageFlagLabel(entry?.key)}
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
            accessorFn: (row) =>
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
            cell: ({ row }) => {
                const links = Array.isArray(row.original?.bioLinks)
                    ? row.original.bioLinks.filter(Boolean)
                    : [];
                return links.length ? (
                    <div className="flex items-center gap-1">
                        {links.map((link) => (
                            <Button
                                key={link}
                                type="button"
                                title={link}
                                variant="outline"
                                size="icon-sm"
                                className="size-7"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void openExternalLink(link);
                                }}
                            >
                                <img
                                    src={getFaviconUrl(link)}
                                    alt=""
                                    className="size-4"
                                    loading="lazy"
                                />
                            </Button>
                        ))}
                    </div>
                ) : null;
            }
        },
        {
            id: 'joinCount',
            accessorFn: (row) => Number.parseInt(row?.$joinCount ?? 0, 10) || 0,
            size: 120,
            meta: { label: t('table.friendList.joinCount') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.joinCount')}
                />
            ),
            cell: ({ row }) => (
                <span className="block text-right">
                    {row.original?.$joinCount || ''}
                </span>
            )
        },
        {
            id: 'timeTogether',
            accessorFn: (row) => Number.parseInt(row?.$timeSpent ?? 0, 10) || 0,
            size: 150,
            meta: { label: t('table.friendList.timeTogether') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.timeTogether')}
                />
            ),
            cell: ({ row }) => {
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
            accessorFn: (row) => row?.$lastSeen || '',
            size: 180,
            meta: { label: t('table.friendList.lastSeen') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.lastSeen')}
                />
            ),
            cell: ({ row }) => {
                const text = formatDateFilter(row.original?.$lastSeen, 'long');
                return <span>{text === '-' ? '' : text}</span>;
            }
        },
        {
            id: 'mutualFriends',
            accessorFn: (row) => Number.parseInt(row?.$mutualCount ?? 0, 10) || 0,
            size: 140,
            meta: { label: t('table.friendList.mutualFriends') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.mutualFriends')}
                />
            ),
            cell: ({ row }) => {
                const count =
                    Number.parseInt(row.original?.$mutualCount ?? 0, 10) || 0;
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
            accessorFn: (row) => row?.last_activity || '',
            size: 200,
            meta: { label: t('table.friendList.lastActivity') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.lastActivity')}
                />
            ),
            cell: ({ row }) => {
                const text = formatDateFilter(row.original?.last_activity, 'long');
                return <span>{text === '-' ? '' : text}</span>;
            }
        },
        {
            id: 'lastLogin',
            accessorFn: (row) => row?.last_login || '',
            size: 200,
            meta: { label: t('table.friendList.lastLogin') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.lastLogin')}
                />
            ),
            cell: ({ row }) => {
                const text = formatDateFilter(row.original?.last_login, 'long');
                return <span>{text === '-' ? '' : text}</span>;
            }
        },
        {
            id: 'dateJoined',
            accessorFn: (row) => row?.date_joined || '',
            size: 140,
            meta: { label: t('table.friendList.dateJoined') },
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.friendList.dateJoined')}
                />
            ),
            cell: ({ row }) => <span>{row.original?.date_joined || ''}</span>
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
            cell: ({ row }) => {
                const friendId = normalizeId(row.original?.id);
                return (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive size-7"
                        aria-label={t('table.friendList.unfriend')}
                        disabled={
                            !currentUserId || deletingFriendIds.has(friendId)
                        }
                        onClick={(event) => {
                            event.stopPropagation();
                            void onConfirmDeleteFriend(row.original);
                        }}
                    >
                        <UserMinusIcon data-icon="inline-start" />
                    </Button>
                );
            }
        }
    ];
}
