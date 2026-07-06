import type { ColumnDef } from '@tanstack/react-table';
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
    type FriendListRow,
    friendNumberForSort,
    normalizeFriendListId as normalizeId
} from '../friendListRows';
import { SortButton } from './FriendListViewParts';

type FriendListColumnsOptions = {
    bulkUnfriendMode: boolean;
    currentUserId: string | null;
    deletingFriendIds: Set<string>;
    onConfirmDeleteFriend(friend: FriendListRow): void;
    onToggleSelectedFriend(friendId: string): void;
    randomUserColours: boolean;
    selectedFriendIds: Set<string>;
};

function parseListNumber(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? 0), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '');
}

function bioLinks(row: FriendListRow): string[] {
    return Array.isArray(row.bioLinks)
        ? row.bioLinks.map(textValue).filter(Boolean)
        : [];
}

export function useFriendListColumns({
    bulkUnfriendMode,
    currentUserId,
    deletingFriendIds,
    onConfirmDeleteFriend,
    onToggleSelectedFriend,
    randomUserColours,
    selectedFriendIds
}: FriendListColumnsOptions) {
    const { t } = useTranslation();
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    return useMemo<ColumnDef<FriendListRow>[]>(
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
                    parseListNumber(row?.$friendNumber ?? row?.friendNumber),
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.no')}
                        descFirst
                    />
                ),
                cell: ({ row }) => {
                    const friendNumber =
                        parseListNumber(
                            row.original?.$friendNumber ??
                                row.original?.friendNumber ??
                                row.getValue('friendNumber')
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
                                normalizeId(row.original?.id) ||
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
                enableSorting: false,
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.displayName')}
                    </span>
                ),
                cell: ({ row }) => {
                    const friendId = normalizeId(row.original?.id);
                    const nameStyle =
                        randomUserColours && friendId
                            ? {
                                  color: getNameColour(friendId, isDarkMode)
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
                accessorFn: (row) => parseListNumber(row?.$trustSortNum),
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.rank')}
                    />
                ),
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'text-sm',
                            textValue(row.original?.$trustClass)
                        )}
                    >
                        {textValue(row.original?.$trustLevel)}
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
                            {status.label ? (
                                <span className="truncate">{status.label}</span>
                            ) : null}
                        </span>
                    );
                }
            },
            {
                id: 'language',
                accessorFn: (row) =>
                    resolveFriendLanguageRows(row)
                        .map((entry) => entry?.value || '')
                        .join('\u0000'),
                size: 160,
                meta: { label: t('table.friendList.language') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.language')}
                    />
                ),
                cell: ({ row }) => {
                    const languages = resolveFriendLanguageRows(row.original);
                    return languages.length ? (
                        <div className="flex flex-wrap items-center gap-1">
                            {languages.map((entry) => {
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
                                        <TooltipTrigger
                                            render={
                                                <span
                                                    className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold"
                                                    aria-label={tooltipLabel}
                                                >
                                                    {code}
                                                </span>
                                            }
                                        />
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
                accessorFn: (row) => bioLinks(row).join('\u0000'),
                size: 140,
                enableSorting: false,
                meta: { label: t('table.friendList.bioLink') },
                header: () => (
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t('table.friendList.bioLink')}
                    </span>
                ),
                cell: ({ row }) => {
                    const links = bioLinks(row.original);
                    return links.length ? (
                        <div className="flex items-center gap-1">
                            {links.map((link) => (
                                <Tooltip key={link}>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                className="size-7"
                                                onClick={(event) => {
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
                                        }
                                    />
                                    <TooltipContent>{link}</TooltipContent>
                                </Tooltip>
                            ))}
                        </div>
                    ) : null;
                }
            },
            {
                id: 'joinCount',
                accessorFn: (row) => parseListNumber(row?.$joinCount),
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
                accessorFn: (row) => parseListNumber(row?.$timeSpent),
                size: 150,
                meta: { label: t('table.friendList.timeTogether') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.timeTogether')}
                    />
                ),
                cell: ({ row }) => {
                    const timeSpent = parseListNumber(row.original?.$timeSpent);
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
                    const text = formatDateFilter(
                        row.original?.$lastSeen,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'mutualFriends',
                accessorFn: (row) => parseListNumber(row?.$mutualCount),
                size: 140,
                meta: { label: t('table.friendList.mutualFriends') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.mutualFriends')}
                    />
                ),
                cell: ({ row }) => {
                    const count = parseListNumber(row.original?.$mutualCount);
                    const optedOut = Boolean(row.original?.$mutualOptedOut);
                    return count || optedOut ? (
                        <span className="flex items-center justify-end gap-1">
                            {count || ''}
                            {optedOut ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span className="inline-flex">
                                                <EyeOffIcon className="text-muted-foreground size-3.5" />
                                            </span>
                                        }
                                    />
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
                accessorFn: (row) => textValue(row?.last_activity),
                size: 200,
                meta: { label: t('table.friendList.lastActivity') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastActivity')}
                    />
                ),
                cell: ({ row }) => {
                    const text = formatDateFilter(
                        row.original?.last_activity,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'lastLogin',
                accessorFn: (row) => textValue(row?.last_login),
                size: 200,
                meta: { label: t('table.friendList.lastLogin') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.lastLogin')}
                    />
                ),
                cell: ({ row }) => {
                    const text = formatDateFilter(
                        row.original?.last_login,
                        'long'
                    );
                    return <span>{text === '-' ? '' : text}</span>;
                }
            },
            {
                id: 'dateJoined',
                accessorFn: (row) => textValue(row?.date_joined),
                size: 140,
                meta: { label: t('table.friendList.dateJoined') },
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.friendList.dateJoined')}
                    />
                ),
                cell: ({ row }) => (
                    <span>{textValue(row.original?.date_joined)}</span>
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
                                !currentUserId ||
                                deletingFriendIds.has(friendId)
                            }
                            onClick={(event) => {
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
