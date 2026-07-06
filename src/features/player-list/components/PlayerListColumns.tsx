import type { ColumnDef, Row } from '@tanstack/react-table';
import { ExternalLinkIcon, IdCardIcon, UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { getNameColour, openExternalLink } from '@/services/entityMediaService';
import { getFaviconUrl } from '@/shared/utils/urlUtils';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageCodeLabel,
    resolvePlatformMode,
    resolveStatusMeta
} from '../playerListDisplay';
import type { PlayerListLanguageRow, PlayerListRow } from '../playerListTypes';
import { SortButton } from './PlayerListViewParts';

const PLAYER_ICON_GLYPHS: Record<string, string> = {
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

function HeaderLabel({ children }: { children: ReactNode }) {
    return (
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {children}
        </span>
    );
}

function AvatarCell({ row }: { row: Row<PlayerListRow> }) {
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

function DisplayNameCell({
    isDarkMode,
    randomUserColours,
    row
}: {
    isDarkMode: boolean;
    randomUserColours: boolean;
    row: Row<PlayerListRow>;
}) {
    const style =
        randomUserColours && row.original?.userId
            ? {
                  color: getNameColour(row.original.userId, isDarkMode)
              }
            : undefined;
    const { t } = useTranslation();
    const moderationTags = Array.isArray(row.original?.moderationTags)
        ? row.original.moderationTags
        : [];

    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm" style={style}>
                {row.original.displayName}
            </span>
            {moderationTags.includes('blocked') ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span className="inline-flex shrink-0">
                                <Badge
                                    variant="destructive"
                                    className="h-4 px-1.5 text-[10px] leading-none"
                                >
                                    {t('view.player_list.error.blocked')}
                                </Badge>
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t('view.player_list.error.blocked')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {moderationTags.includes('muted') ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span className="inline-flex shrink-0">
                                <Badge
                                    variant="outline"
                                    className="text-muted-foreground h-4 px-1.5 text-[10px] leading-none"
                                >
                                    {t('view.player_list.label.muted')}
                                </Badge>
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t('view.player_list.label.muted')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
        </span>
    );
}

function StatusCell({ row }: { row: Row<PlayerListRow> }) {
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

function PlayerIconCell({ row }: { row: Row<PlayerListRow> }) {
    const { t } = useTranslation();

    return (
        <div className="flex items-center justify-center gap-1">
            {row.original.isMaster ? (
                <Tooltip>
                    <TooltipTrigger
                        render={<span>{PLAYER_ICON_GLYPHS.master}</span>}
                    />
                    <TooltipContent>
                        {t('view.player_list.label.instance_master')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isModerator ? (
                <Tooltip>
                    <TooltipTrigger
                        render={<span>{PLAYER_ICON_GLYPHS.moderator}</span>}
                    />
                    <TooltipContent>
                        {t('view.player_list.label.moderator')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isFavorite ? (
                <Tooltip>
                    <TooltipTrigger
                        render={<span>{PLAYER_ICON_GLYPHS.favorite}</span>}
                    />
                    <TooltipContent>
                        {t('view.player_list.label.favorite')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {!row.original.isFavorite && row.original.isFriend ? (
                <Tooltip>
                    <TooltipTrigger
                        render={<span>{PLAYER_ICON_GLYPHS.friend}</span>}
                    />
                    <TooltipContent>
                        {t('side_panel.notification_center.tab_friend')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isBlocked ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span className="text-destructive">
                                {PLAYER_ICON_GLYPHS.blocked}
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t('view.player_list.error.blocked')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isMuted ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span className="text-muted-foreground">
                                {PLAYER_ICON_GLYPHS.muted}
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t('view.player_list.label.muted')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isAvatarInteractionDisabled ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span className="text-muted-foreground">
                                {PLAYER_ICON_GLYPHS.avatarInteractionDisabled}
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t(
                            'view.player_list.label.avatar_interaction_disabled'
                        )}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isChatBoxMuted ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span className="text-muted-foreground">
                                {PLAYER_ICON_GLYPHS.chatboxMuted}
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t('view.player_list.label.chatbox_muted')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.timeoutTime ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span className="text-destructive">
                                {PLAYER_ICON_GLYPHS.timeout}
                                {row.original.timeoutTime}
                                {t('common.time_units.s')}
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t('view.player_list.label.timeout')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.ageVerified ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span>
                                <IdCardIcon className="x-tag-age-verification size-4" />
                            </span>
                        }
                    />
                    <TooltipContent>
                        {t('view.player_list.label.age_verified')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
        </div>
    );
}

function PlatformCell({ row }: { row: Row<PlayerListRow> }) {
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

function normalizeTooltipText(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function languageTooltipLabel(
    entry: PlayerListLanguageRow | null | undefined,
    code: string
) {
    const original = normalizeTooltipText(
        entry?.value || entry?.label || entry?.name
    );
    return original || code;
}

function LanguageCell({ row }: { row: Row<PlayerListRow> }) {
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

function BioLinksCell({ row }: { row: Row<PlayerListRow> }) {
    return (
        <div className="flex items-center gap-1">
            {row.original.bioLinks.length
                ? row.original.bioLinks.map((link, index) => {
                      const faviconUrl = getFaviconUrl(link);
                      const linkLabel = String(link ?? '');

                      return (
                          <Tooltip key={`${linkLabel}:${index}`}>
                              <TooltipTrigger
                                  render={
                                      <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          aria-label={`Open Link: ${linkLabel}`}
                                          onClick={(event) => {
                                              event.stopPropagation();
                                              openExternalLink(link);
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

export function usePlayerListColumns(): ColumnDef<PlayerListRow>[] {
    const { t } = useTranslation();
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    return useMemo<ColumnDef<PlayerListRow>[]>(
        () => [
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
                    <SortButton
                        column={column}
                        label={t('table.playerList.timer')}
                    />
                ),
                cell: ({ row }) => (
                    <span className="text-sm">
                        {Number(row.original.joinedAtMs) > 0
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
                    <SortButton
                        column={column}
                        label={t('table.playerList.rank')}
                    />
                ),
                cell: ({ row }) => (
                    <span
                        className={cn('text-sm', row.original.trustClass || '')}
                    >
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
                    <SortButton
                        column={column}
                        label={t('table.playerList.icon')}
                    />
                ),
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
        ],
        [isDarkMode, randomUserColours, t]
    );
}
