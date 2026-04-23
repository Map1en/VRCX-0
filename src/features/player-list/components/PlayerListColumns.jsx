import {
    ExternalLinkIcon,
    IdCardIcon,
    UserIcon
} from 'lucide-react';

import { timeToText } from '@/lib/dateTime.js';
import { getNameColour, openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageCodeLabel,
    resolvePlatformMode,
    resolveStatusMeta
} from '../playerListDisplay.js';
import { SortButton } from './PlayerListViewParts.jsx';

const PLAYER_ICON_GLYPHS = {
    master: '\u{1f451}',
    moderator: '\u2694\ufe0f',
    favorite: '\u2b50',
    friend: '\u{1f49a}',
    blocked: '\u26d4',
    muted: '\u{1f507}',
    avatarInteractionDisabled: '\u{1f6ab}',
    chatboxMuted: '\u{1f4ac}',
    timeout: '\u{1f534}'
};

function HeaderLabel({ children }) {
    return (
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {children}
        </span>
    );
}

function AvatarCell({ row }) {
    return row.original.avatarUrl ? (
        <img
            src={row.original.avatarUrl}
            alt={row.original.displayName || 'Player avatar'}
            loading="lazy"
            className="size-4 rounded-sm object-cover"
        />
    ) : (
        <span className="bg-muted flex size-4 items-center justify-center rounded-sm">
            <UserIcon className="text-muted-foreground size-3" />
        </span>
    );
}

function DisplayNameCell({ isDarkMode, randomUserColours, row }) {
    const style =
        randomUserColours && row.original?.userId
            ? {
                  color: getNameColour(row.original.userId, isDarkMode)
              }
            : undefined;

    return (
        <span className="block min-w-0 truncate text-sm" style={style}>
            {row.original.displayName}
        </span>
    );
}

function StatusCell({ row }) {
    const status = resolveStatusMeta(row.original);

    return (
        <span className="flex w-full min-w-0 items-center gap-2">
            {status.indicatorClassName ? (
                <i className={status.indicatorClassName} />
            ) : null}
            <span className="min-w-0 truncate text-sm">{status.label}</span>
        </span>
    );
}

function PlayerIconCell({ row, t }) {
    return (
        <div className="flex items-center justify-center gap-1">
            {row.original.isMaster ? (
                <span title={t('view.player_list.generated.instance_master')}>
                    {PLAYER_ICON_GLYPHS.master}
                </span>
            ) : null}
            {row.original.isModerator ? (
                <span title={t('view.player_list.generated.moderator')}>
                    {PLAYER_ICON_GLYPHS.moderator}
                </span>
            ) : null}
            {row.original.isFavorite ? (
                <span title={t('view.player_list.generated.favorite')}>
                    {PLAYER_ICON_GLYPHS.favorite}
                </span>
            ) : null}
            {!row.original.isFavorite && row.original.isFriend ? (
                <span title={t('side_panel.notification_center.tab_friend')}>
                    {PLAYER_ICON_GLYPHS.friend}
                </span>
            ) : null}
            {row.original.isBlocked ? (
                <span
                    className="text-destructive"
                    title={t('view.player_list.generated.blocked')}
                >
                    {PLAYER_ICON_GLYPHS.blocked}
                </span>
            ) : null}
            {row.original.isMuted ? (
                <span
                    className="text-muted-foreground"
                    title={t('view.player_list.generated.muted')}
                >
                    {PLAYER_ICON_GLYPHS.muted}
                </span>
            ) : null}
            {row.original.isAvatarInteractionDisabled ? (
                <span
                    className="text-muted-foreground"
                    title={t(
                        'view.player_list.generated.avatar_interaction_disabled'
                    )}
                >
                    {PLAYER_ICON_GLYPHS.avatarInteractionDisabled}
                </span>
            ) : null}
            {row.original.isChatBoxMuted ? (
                <span
                    className="text-muted-foreground"
                    title={t('view.player_list.generated.chatbox_muted')}
                >
                    {PLAYER_ICON_GLYPHS.chatboxMuted}
                </span>
            ) : null}
            {row.original.timeoutTime ? (
                <span
                    className="text-destructive"
                    title={t('view.player_list.generated.timeout')}
                >
                    {PLAYER_ICON_GLYPHS.timeout}
                    {row.original.timeoutTime}
                    {t('common.time_units.s')}
                </span>
            ) : null}
            {row.original.ageVerified ? (
                <IdCardIcon
                    className="x-tag-age-verification size-4"
                    title={t('view.player_list.generated.age_verified')}
                />
            ) : null}
        </div>
    );
}

function PlatformCell({ row }) {
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

function LanguageCell({ row }) {
    return (
        <div className="flex flex-wrap items-center gap-1">
            {row.original.languages.length
                ? row.original.languages.map((entry) => {
                      const key = entry?.key || entry?.value || '';
                      const code = languageCodeLabel(key);
                      if (!code) {
                          return null;
                      }
                      return (
                          <Tooltip key={`${key}:${entry?.value || ''}`}>
                              <TooltipTrigger asChild>
                                  <span className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold">
                                      {code}
                                  </span>
                              </TooltipTrigger>
                              <TooltipContent>{code}</TooltipContent>
                          </Tooltip>
                      );
                  })
                : null}
        </div>
    );
}

function BioLinksCell({ row }) {
    return (
        <div className="flex items-center gap-1">
            {row.original.bioLinks.length
                ? row.original.bioLinks.map((link, index) => {
                      const faviconUrl = getFaviconUrl(link);

                      return (
                          <Button
                              key={`${link}:${index}`}
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Open Link: ${link}`}
                              title={link}
                              onClick={(event) => {
                                  event.stopPropagation();
                                  void openExternalLink(link);
                              }}
                          >
                              {faviconUrl ? (
                                  <img
                                      src={faviconUrl}
                                      alt=""
                                      className="size-4"
                                  />
                              ) : (
                                  <ExternalLinkIcon data-icon="inline-start" />
                              )}
                          </Button>
                      );
                  })
                : null}
        </div>
    );
}

export function buildPlayerListColumns({ isDarkMode, randomUserColours, t }) {
    return [
        {
            id: 'avatar',
            size: 72,
            meta: { label: t('table.playerList.avatar') },
            header: () => (
                <HeaderLabel>{t('table.playerList.avatar')}</HeaderLabel>
            ),
            accessorFn: (row) => row.avatarUrl,
            enableSorting: false,
            cell: ({ row }) => <AvatarCell row={row} />
        },
        {
            id: 'timer',
            size: 96,
            meta: { label: t('table.playerList.timer') },
            accessorFn: (row) => row.timerMs,
            header: ({ column }) => (
                <SortButton column={column} label={t('table.playerList.timer')} />
            ),
            cell: ({ row }) => (
                <span className="text-sm">
                    {row.original.joinedAtMs > 0
                        ? timeToText(row.original.timerMs, true)
                        : ''}
                </span>
            )
        },
        {
            id: 'displayName',
            size: 280,
            meta: { label: t('table.playerList.displayName') },
            accessorFn: (row) => row.displayName,
            header: ({ column }) => (
                <SortButton
                    column={column}
                    label={t('table.playerList.displayName')}
                />
            ),
            sortingFn: (rowA, rowB) =>
                String(rowA.original?.displayName || '').localeCompare(
                    String(rowB.original?.displayName || ''),
                    undefined,
                    { sensitivity: 'base' }
                ),
            cell: ({ row }) => (
                <DisplayNameCell
                    isDarkMode={isDarkMode}
                    randomUserColours={randomUserColours}
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
                <SortButton column={column} label={t('table.playerList.rank')} />
            ),
            cell: ({ row }) => (
                <span className={cn('text-sm', row.original.trustClass || '')}>
                    {row.original.trustLevel || ''}
                </span>
            )
        },
        {
            id: 'status',
            size: 220,
            meta: { label: t('table.playerList.status') },
            accessorFn: (row) => resolveStatusMeta(row).label,
            header: () => (
                <HeaderLabel>{t('table.playerList.status')}</HeaderLabel>
            ),
            enableSorting: false,
            cell: ({ row }) => <StatusCell row={row} />
        },
        {
            id: 'icon',
            size: 140,
            meta: { label: t('table.playerList.icon') },
            accessorFn: (row) => row.iconWeight,
            header: ({ column }) => (
                <SortButton column={column} label={t('table.playerList.icon')} />
            ),
            cell: ({ row }) => <PlayerIconCell row={row} t={t} />
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
            size: 120,
            meta: { label: t('table.playerList.language') },
            accessorFn: (row) =>
                row.languages
                    .map((entry) => entry?.value || entry?.key || '')
                    .join('\u0000'),
            header: () => (
                <HeaderLabel>{t('table.playerList.language')}</HeaderLabel>
            ),
            enableSorting: false,
            cell: ({ row }) => <LanguageCell row={row} />
        },
        {
            id: 'bioLink',
            size: 120,
            meta: { label: t('table.playerList.bioLink') },
            accessorFn: (row) => row.bioLinks.join('\u0000'),
            header: () => (
                <HeaderLabel>{t('table.playerList.bioLink')}</HeaderLabel>
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
                <HeaderLabel>{t('table.playerList.note')}</HeaderLabel>
            ),
            enableSorting: false,
            cell: ({ row }) => (
                <span className="block truncate text-sm">
                    {row.original.note || ''}
                </span>
            )
        }
    ];
}
