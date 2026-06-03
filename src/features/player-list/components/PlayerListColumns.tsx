import { ExternalLinkIcon, IdCardIcon, UserIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { timeToText } from '@/lib/dateTime';
import { getNameColour, openExternalLink } from '@/services/entityMediaService';
import { cn } from '@/lib/utils';
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
import { SortButton } from './PlayerListViewParts';

const PLAYER_ICON_GLYPHS: any = {
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

function HeaderLabel({ children }: any) {
    return (
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {children}
        </span>
    );
}

function AvatarCell({ row }: any) {
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

function DisplayNameCell({ isDarkMode, randomUserColours, row }: any) {
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
                    <TooltipTrigger asChild>
                        <span className="inline-flex shrink-0">
                            <Badge
                                variant="destructive"
                                className="h-4 px-1.5 text-[10px] leading-none"
                            >
                                {t('view.player_list.error.blocked')}
                            </Badge>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.error.blocked')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {moderationTags.includes('muted') ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex shrink-0">
                            <Badge
                                variant="outline"
                                className="text-muted-foreground h-4 px-1.5 text-[10px] leading-none"
                            >
                                {t('view.player_list.label.muted')}
                            </Badge>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.muted')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
        </span>
    );
}

function StatusCell({ row }: any) {
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

function PlayerIconCell({ row }: any) {
    const { t } = useTranslation();

    return (
        <div className="flex items-center justify-center gap-1">
            {row.original.isMaster ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>{PLAYER_ICON_GLYPHS.master}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.instance_master')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isModerator ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>{PLAYER_ICON_GLYPHS.moderator}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.moderator')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isFavorite ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>{PLAYER_ICON_GLYPHS.favorite}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.favorite')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {!row.original.isFavorite && row.original.isFriend ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>{PLAYER_ICON_GLYPHS.friend}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('side_panel.notification_center.tab_friend')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isBlocked ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-destructive">
                            {PLAYER_ICON_GLYPHS.blocked}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.error.blocked')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isMuted ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-muted-foreground">
                            {PLAYER_ICON_GLYPHS.muted}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.muted')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isAvatarInteractionDisabled ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-muted-foreground">
                            {PLAYER_ICON_GLYPHS.avatarInteractionDisabled}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t(
                            'view.player_list.label.avatar_interaction_disabled'
                        )}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.isChatBoxMuted ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-muted-foreground">
                            {PLAYER_ICON_GLYPHS.chatboxMuted}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.chatbox_muted')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.timeoutTime ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-destructive">
                            {PLAYER_ICON_GLYPHS.timeout}
                            {row.original.timeoutTime}
                            {t('common.time_units.s')}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.timeout')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
            {row.original.ageVerified ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span>
                            <IdCardIcon className="x-tag-age-verification size-4" />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('view.player_list.label.age_verified')}
                    </TooltipContent>
                </Tooltip>
            ) : null}
        </div>
    );
}

function PlatformCell({ row }: any) {
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

function normalizeTooltipText(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function languageTooltipLabel(entry: any, code: any) {
    const original = normalizeTooltipText(
        entry?.value || entry?.label || entry?.name
    );
    return original || code;
}

function LanguageCell({ row }: any) {
    return (
        <div className="flex flex-wrap items-center gap-1">
            {row.original.languages.length
                ? row.original.languages.map((entry: any) => {
                      const key = entry?.key || entry?.value || '';
                      const code = languageCodeLabel(key);
                      const tooltip = languageTooltipLabel(entry, code);
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
                              <TooltipContent>{tooltip}</TooltipContent>
                          </Tooltip>
                      );
                  })
                : null}
        </div>
    );
}

function BioLinksCell({ row }: any) {
    return (
        <div className="flex items-center gap-1">
            {row.original.bioLinks.length
                ? row.original.bioLinks.map((link: any, index: any) => {
                      const faviconUrl = getFaviconUrl(link);

                      return (
                          <Tooltip key={`${link}:${index}`}>
                              <TooltipTrigger asChild>
                                  <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`Open Link: ${link}`}
                                      onClick={(event: any) => {
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
                              </TooltipTrigger>
                              <TooltipContent>{link}</TooltipContent>
                          </Tooltip>
                      );
                  })
                : null}
        </div>
    );
}

export function usePlayerListColumns() {
    const { t } = useTranslation();
    const randomUserColours = usePreferencesStore(
        (state: any) => state.randomUserColours
    );
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    return useMemo(
        () => [
            {
                id: 'avatar',
                size: 72,
                meta: { label: t('table.playerList.avatar') },
                header: () => (
                    <HeaderLabel>{t('table.playerList.avatar')}</HeaderLabel>
                ),
                accessorFn: (row: any) => row.avatarUrl,
                enableSorting: false,
                cell: ({ row }: any) => <AvatarCell row={row} />
            },
            {
                id: 'timer',
                size: 96,
                meta: { label: t('table.playerList.timer') },
                accessorFn: (row: any) => row.timerMs,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.timer')}
                    />
                ),
                cell: ({ row }: any) => (
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
                accessorFn: (row: any) => row.displayName,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.displayName')}
                    />
                ),
                sortingFn: (rowA: any, rowB: any) =>
                    String(rowA.original?.displayName || '').localeCompare(
                        String(rowB.original?.displayName || ''),
                        undefined,
                        { sensitivity: 'base' }
                    ),
                cell: ({ row }: any) => (
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
                accessorFn: (row: any) => row.trustSortNum,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.rank')}
                    />
                ),
                cell: ({ row }: any) => (
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
                accessorFn: (row: any) => resolveStatusMeta(row).label,
                header: () => (
                    <HeaderLabel>{t('table.playerList.status')}</HeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }: any) => <StatusCell row={row} />
            },
            {
                id: 'icon',
                size: 140,
                meta: { label: t('table.playerList.icon') },
                accessorFn: (row: any) => row.iconWeight,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.icon')}
                    />
                ),
                cell: ({ row }: any) => <PlayerIconCell row={row} />
            },
            {
                id: 'platform',
                size: 120,
                meta: { label: t('table.playerList.platform') },
                accessorFn: (row: any) => row.platformLabel,
                header: ({ column }: any) => (
                    <SortButton
                        column={column}
                        label={t('table.playerList.platform')}
                    />
                ),
                cell: ({ row }: any) => <PlatformCell row={row} />
            },
            {
                id: 'language',
                size: 120,
                meta: { label: t('table.playerList.language') },
                accessorFn: (row: any) =>
                    row.languages
                        .map((entry: any) => entry?.value || entry?.key || '')
                        .join('\u0000'),
                header: () => (
                    <HeaderLabel>{t('table.playerList.language')}</HeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }: any) => <LanguageCell row={row} />
            },
            {
                id: 'bioLink',
                size: 120,
                meta: { label: t('table.playerList.bioLink') },
                accessorFn: (row: any) => row.bioLinks.join('\u0000'),
                header: () => (
                    <HeaderLabel>{t('table.playerList.bioLink')}</HeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }: any) => <BioLinksCell row={row} />
            },
            {
                id: 'note',
                size: 180,
                meta: { label: t('table.playerList.note') },
                accessorFn: (row: any) => row.note || '',
                header: () => (
                    <HeaderLabel>{t('table.playerList.note')}</HeaderLabel>
                ),
                enableSorting: false,
                cell: ({ row }: any) => (
                    <span className="block truncate text-sm">
                        {row.original.note || ''}
                    </span>
                )
            }
        ],
        [isDarkMode, randomUserColours, t]
    );
}
