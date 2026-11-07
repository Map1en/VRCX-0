import {
    BanIcon,
    CrownIcon,
    ExternalLinkIcon,
    HandIcon,
    HeartIcon,
    IdCardIcon,
    LockIcon,
    MessageSquareXIcon,
    ShieldCheckIcon,
    StarIcon,
    TimerOffIcon,
    UserIcon,
    VolumeXIcon,
    type LucideIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppColumnDef, AppRow } from '@/components/data-table/appTable';
import { DataTableHeaderLabel } from '@/components/data-table/DataTableSortButton';
import { DATA_TABLE_EMPTY_VALUE } from '@/components/data-table/dataTableStyles';
import {
    DATA_TABLE_CONTROL_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
    DATA_TABLE_PRIMARY_CELL_CLASS_NAME
} from '@/components/data-table/DataTableView';
import { BioLinkFavicon } from '@/components/media/BioLinkFavicon';
import { FadeInImage } from '@/components/media/FadeInImage';
import { MutualFriendAvatars } from '@/components/mutual-friends/MutualFriendAvatars';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { UserStatusDot } from '@/components/UserStatusDot';
import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { getNameColour, openExternalLink } from '@/services/entityMediaService';
import { TRUST_COLOR_ENTRIES } from '@/shared/constants/trustColors';
import type { UserNameColourStyle } from '@/shared/utils/entityMedia';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageCodeLabel,
    resolvePlatformMode,
    resolveStatusMeta
} from '../playerListDisplay';
import { playerGroupRoleOrder } from '../playerListGroupRoles';
import type { PlayerListLanguageRow, PlayerListRow } from '../playerListTypes';
import { SortButton } from './PlayerListViewParts';

const PLAYER_AVATAR_CLASS_NAME =
    'size-[calc(var(--vrcx-0-table-row-height)-1rem)] rounded-full object-cover';

function PlayerAvatarFallback() {
    return (
        <span
            className={cn(
                PLAYER_AVATAR_CLASS_NAME,
                'bg-muted flex items-center justify-center'
            )}
        >
            <UserIcon className="text-muted-foreground size-3.5" />
        </span>
    );
}

function AvatarCell({ row }: { row: AppRow<PlayerListRow> }) {
    return row.original.avatarUrl ? (
        <FadeInImage
            src={row.original.avatarUrl}
            alt={row.original.displayName || 'Player avatar'}
            loading="lazy"
            className={PLAYER_AVATAR_CLASS_NAME}
            fallback={<PlayerAvatarFallback />}
        />
    ) : (
        <PlayerAvatarFallback />
    );
}

function DisplayNameCell({
    isDarkMode,
    randomUserColours,
    randomUserColourStyle,
    row
}: {
    isDarkMode: boolean;
    randomUserColours: boolean;
    randomUserColourStyle: UserNameColourStyle;
    row: AppRow<PlayerListRow>;
}) {
    const style =
        randomUserColours && row.original?.userId
            ? {
                  color: getNameColour(
                      row.original.userId,
                      isDarkMode,
                      randomUserColourStyle
                  )
              }
            : undefined;

    return (
        <UserHoverCard userId={row.original.userId} side="right" align="start">
            <span className="block min-w-0 truncate text-sm" style={style}>
                {row.original.displayName}
            </span>
        </UserHoverCard>
    );
}

function MutualFriendsCell({ row }: { row: AppRow<PlayerListRow> }) {
    const { t } = useTranslation();
    const mutuals = row.original.mutuals;
    if (!mutuals) {
        return null;
    }
    if (mutuals.status === 'idle') {
        return (
            <span className="text-muted-foreground">
                {DATA_TABLE_EMPTY_VALUE}
            </span>
        );
    }
    if (mutuals.status === 'loading') {
        return <Spinner className="text-muted-foreground size-3.5" />;
    }
    if (mutuals.status !== 'ready') {
        return (
            <PlayerFlag
                Icon={LockIcon}
                label={t('view.charts.mutual_friend.label.mutuals_unavailable')}
                className="text-muted-foreground"
                iconClassName="size-3.5"
            />
        );
    }
    if (!mutuals.count) {
        return null;
    }
    const names = mutuals.friends
        .map((friend) => friend.displayName)
        .join(t('user_hover_card.name_separator'));
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="flex min-w-0 items-center gap-1.5">
                        <MutualFriendAvatars friends={mutuals.friends} />
                        {mutuals.community ? (
                            <span
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                    backgroundColor: mutuals.community.color
                                }}
                            />
                        ) : null}
                        <span className="text-sm tabular-nums">
                            {mutuals.count}
                        </span>
                    </span>
                }
            />
            <TooltipContent>
                {mutuals.community
                    ? t('view.player_list.mutual_friends.cell_tooltip_circle', {
                          names,
                          count: mutuals.count,
                          circle: mutuals.community.label
                      })
                    : t('view.player_list.mutual_friends.cell_tooltip', {
                          names,
                          count: mutuals.count
                      })}
            </TooltipContent>
        </Tooltip>
    );
}

function StatusCell({ row }: { row: AppRow<PlayerListRow> }) {
    const status = resolveStatusMeta(row.original);

    return (
        <span className="flex w-full min-w-0 items-center gap-2">
            <UserStatusDot
                statusDotClassName={status.statusDotClassName}
                className="size-2.5 shrink-0"
                variant="inline"
            />
            <span className="min-w-0 truncate text-sm">{status.label}</span>
        </span>
    );
}

type PlayerFlagProps = {
    Icon: LucideIcon;
    label: string;
    className?: string;
    filled?: boolean;
    iconClassName?: string;
    suffix?: ReactNode;
};

function PlayerFlag({
    Icon,
    label,
    className,
    filled = false,
    iconClassName,
    suffix
}: PlayerFlagProps) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        className={cn(
                            'inline-flex shrink-0 items-center gap-0.5',
                            className
                        )}
                        aria-label={label}
                    >
                        <Icon
                            className={cn(
                                'size-4',
                                filled && 'fill-current',
                                iconClassName
                            )}
                        />
                        {suffix}
                    </span>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function PlayerIconCell({ row }: { row: AppRow<PlayerListRow> }) {
    const { t } = useTranslation();

    return (
        <div className="flex items-center gap-1.5">
            {row.original.isBlocked ? (
                <PlayerFlag
                    Icon={BanIcon}
                    label={t('view.player_list.error.blocked')}
                    className="text-destructive"
                />
            ) : null}
            {row.original.timeoutTime ? (
                <PlayerFlag
                    Icon={TimerOffIcon}
                    label={t('view.player_list.label.timeout')}
                    className="text-orange-400"
                    suffix={
                        <span className="font-mono text-[10px] leading-none tabular-nums">
                            {row.original.timeoutTime}
                            {t('common.time_units.s')}
                        </span>
                    }
                />
            ) : null}
            {row.original.isMuted ? (
                <PlayerFlag
                    Icon={VolumeXIcon}
                    label={t('view.player_list.label.muted')}
                    className="text-orange-400"
                />
            ) : null}
            {row.original.isAvatarInteractionDisabled ? (
                <PlayerFlag
                    Icon={HandIcon}
                    label={t(
                        'view.player_list.label.avatar_interaction_disabled'
                    )}
                    className="text-muted-foreground"
                />
            ) : null}
            {row.original.isChatBoxMuted ? (
                <PlayerFlag
                    Icon={MessageSquareXIcon}
                    label={t('view.player_list.label.chatbox_muted')}
                    className="text-muted-foreground"
                />
            ) : null}
            {row.original.isMaster ? (
                <PlayerFlag
                    Icon={CrownIcon}
                    label={t('view.player_list.label.instance_master')}
                    className="text-amber-400"
                />
            ) : null}
            {row.original.isModerator ? (
                <PlayerFlag
                    Icon={ShieldCheckIcon}
                    label={t('view.player_list.label.moderator')}
                    className="text-sky-400"
                />
            ) : null}
            {row.original.isFavorite ? (
                <PlayerFlag
                    Icon={StarIcon}
                    label={t('view.player_list.label.favorite')}
                    className="text-amber-400"
                    filled
                />
            ) : null}
            {!row.original.isFavorite && row.original.isFriend ? (
                <PlayerFlag
                    Icon={HeartIcon}
                    label={t('side_panel.notification_center.tab_friend')}
                    className="text-rose-400"
                    filled
                />
            ) : null}
            {row.original.ageVerified ? (
                <PlayerFlag
                    Icon={IdCardIcon}
                    label={t('view.player_list.label.age_verified')}
                    iconClassName="x-tag-age-verification"
                />
            ) : null}
        </div>
    );
}

function PlatformCell({ row }: { row: AppRow<PlayerListRow> }) {
    const Icon = row.original.platformIcon;
    const mode = resolvePlatformMode(row.original);

    return (
        <div
            className={cn(
                'flex items-center gap-2 text-sm',
                row.original.platformClassName
            )}
        >
            {Icon ? <Icon className="size-4" /> : null}
            {!Icon ? <span>{row.original.platformLabel}</span> : null}
            {mode ? (
                <span className="text-muted-foreground">{mode}</span>
            ) : null}
        </div>
    );
}

function languageTooltipLabel(
    entry: PlayerListLanguageRow | null | undefined,
    code: string
) {
    const original = entry?.value?.trim() || '';
    return original || code;
}

function LanguageCell({ row }: { row: AppRow<PlayerListRow> }) {
    return (
        <div className="flex flex-wrap items-center gap-1">
            {row.original.languages.length
                ? row.original.languages.map((entry) => {
                      const key = entry?.key || entry?.value || '';
                      const code = languageCodeLabel(key);
                      const tooltip = languageTooltipLabel(entry, code);
                      if (!code) {
                          return null;
                      }
                      return (
                          <Tooltip key={`${key}:${entry?.value || ''}`}>
                              <TooltipTrigger
                                  render={
                                      <span className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold">
                                          {code}
                                      </span>
                                  }
                              />
                              <TooltipContent>{tooltip}</TooltipContent>
                          </Tooltip>
                      );
                  })
                : null}
        </div>
    );
}

function BioLinksCell({ row }: { row: AppRow<PlayerListRow> }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-1">
            {row.original.bioLinks.length
                ? row.original.bioLinks.map((link, index) => {
                      const linkLabel = String(link ?? '');

                      return (
                          <Tooltip key={`${linkLabel}:${index}`}>
                              <TooltipTrigger
                                  render={
                                      <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          aria-label={t(
                                              'accessibility.open_link',
                                              { link: linkLabel }
                                          )}
                                          onClick={(event) => {
                                              event.stopPropagation();
                                              openExternalLink(link);
                                          }}
                                      >
                                          <BioLinkFavicon
                                              link={link}
                                              fallback={
                                                  <ExternalLinkIcon data-icon="inline-start" />
                                              }
                                          />
                                      </Button>
                                  }
                              />
                              <TooltipContent>{linkLabel}</TooltipContent>
                          </Tooltip>
                      );
                  })
                : null}
        </div>
    );
}

export function usePlayerListColumns(): AppColumnDef<PlayerListRow>[] {
    const { t } = useTranslation();
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const randomUserColourStyle = usePreferencesStore(
        (state) => state.randomUserColourStyle
    );
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    return useMemo<AppColumnDef<PlayerListRow>[]>(
        () => [
            {
                id: 'avatar',
                size: 72,
                minSize: 72,
                maxSize: 72,
                enableResizing: false,
                meta: { label: t('table.playerList.avatar') },
                header: () => (
                    <DataTableHeaderLabel>
                        {t('table.playerList.avatar')}
                    </DataTableHeaderLabel>
                ),
                accessorFn: (row) => row.avatarUrl,
                enableSorting: false,
                cell: ({ row }) => <AvatarCell row={row} />
            },
            {
                id: 'timer',
                size: 96,
                meta: {
                    label: t('table.playerList.timer'),
                    tableHeadClassName: DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
                    tableCellClassName: DATA_TABLE_NUMERIC_CELL_CLASS_NAME
                },
                accessorFn: (row) => row.timerMs,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.timer')}
                        className="ml-auto"
                    />
                ),
                cell: ({ row }) => (
                    <span className="text-sm">
                        {Number(row.original.joinedAtMs) > 0
                            ? timeToText(row.original.timerMs)
                            : ''}
                    </span>
                )
            },
            {
                id: 'displayName',
                size: 280,
                enableHiding: false,
                meta: {
                    label: t('table.playerList.displayName'),
                    stretch: true,
                    tableCellClassName: DATA_TABLE_PRIMARY_CELL_CLASS_NAME
                },
                accessorFn: (row) => row.displayName,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.displayName')}
                    />
                ),
                sortFn: (rowA, rowB) =>
                    String(rowA.original?.displayName || '').localeCompare(
                        String(rowB.original?.displayName || ''),
                        undefined,
                        { sensitivity: 'base' }
                    ),
                cell: ({ row }) => (
                    <DisplayNameCell
                        isDarkMode={isDarkMode}
                        randomUserColours={randomUserColours}
                        randomUserColourStyle={randomUserColourStyle}
                        row={row}
                    />
                )
            },
            {
                id: 'rank',
                size: 120,
                meta: { label: t('table.playerList.rank') },
                accessorFn: (row) => row.trustSortNum,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.rank')}
                    />
                ),
                cell: ({ row }) => {
                    const trustEntry = TRUST_COLOR_ENTRIES.find(
                        (entry) => entry.className === row.original.trustClass
                    );
                    return (
                        <span
                            className={cn(
                                'text-sm',
                                row.original.trustClass || ''
                            )}
                        >
                            {trustEntry
                                ? t(trustEntry.labelKey)
                                : row.original.trustLevel || ''}
                        </span>
                    );
                }
            },
            {
                id: 'mutualFriends',
                size: 140,
                enableHiding: false,
                meta: { label: t('table.playerList.mutualFriends') },
                accessorFn: (row) =>
                    row.mutuals?.status === 'ready'
                        ? row.mutuals.count
                        : undefined,
                sortUndefined: 'last',
                sortDescFirst: true,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.mutualFriends')}
                    />
                ),
                cell: ({ row }) => <MutualFriendsCell row={row} />
            },
            {
                id: 'groupRoles',
                size: 180,
                meta: { label: t('table.playerList.groupRoles') },
                accessorFn: (row) => playerGroupRoleOrder(row.groupRoles),
                sortUndefined: 'last',
                sortDescFirst: false,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.groupRoles')}
                    />
                ),
                cell: ({ row }) => {
                    const roles = row.original.groupRoles;
                    if (!roles) return <span>{DATA_TABLE_EMPTY_VALUE}</span>;
                    const label = roles.length
                        ? roles.map((role) => role.name).join(' · ')
                        : t('dialog.group.role_name.everyone');
                    return (
                        <span className="block truncate text-sm" title={label}>
                            {label}
                        </span>
                    );
                }
            },
            {
                id: 'status',
                size: 220,
                meta: { label: t('table.playerList.status') },
                accessorFn: (row) => resolveStatusMeta(row).label,
                header: () => (
                    <DataTableHeaderLabel>
                        {t('table.playerList.status')}
                    </DataTableHeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }) => <StatusCell row={row} />
            },
            {
                id: 'icon',
                size: 160,
                meta: { label: t('table.playerList.icon') },
                header: () => (
                    <DataTableHeaderLabel>
                        {t('table.playerList.icon')}
                    </DataTableHeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }) => <PlayerIconCell row={row} />
            },
            {
                id: 'platform',
                size: 120,
                meta: { label: t('table.playerList.platform') },
                accessorFn: (row) => row.platformLabel,
                header: ({ column }) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.platform')}
                    />
                ),
                cell: ({ row }) => <PlatformCell row={row} />
            },
            {
                id: 'language',
                size: 176,
                meta: { label: t('table.playerList.language') },
                accessorFn: (row) =>
                    row.languages
                        .map((entry) => entry?.value || entry?.key || '')
                        .join('\u0000'),
                header: () => (
                    <DataTableHeaderLabel>
                        {t('table.playerList.language')}
                    </DataTableHeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }) => <LanguageCell row={row} />
            },
            {
                id: 'bioLink',
                size: 120,
                meta: {
                    label: t('table.playerList.bioLink'),
                    tableCellClassName: DATA_TABLE_CONTROL_CELL_CLASS_NAME
                },
                accessorFn: (row) => row.bioLinks.join('\u0000'),
                header: () => (
                    <DataTableHeaderLabel>
                        {t('table.playerList.bioLink')}
                    </DataTableHeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }) => <BioLinksCell row={row} />
            },
            {
                id: 'note',
                size: 180,
                meta: { label: t('table.playerList.note') },
                accessorFn: (row) => row.note || '',
                header: () => (
                    <DataTableHeaderLabel>
                        {t('table.playerList.note')}
                    </DataTableHeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }) => (
                    <span className="block truncate text-sm">
                        {row.original.note || ''}
                    </span>
                )
            }
        ],
        [isDarkMode, randomUserColours, randomUserColourStyle, t]
    );
}
