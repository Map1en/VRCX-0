import { ChevronUpIcon, ClipboardCopyIcon } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { DATA_TABLE_EMPTY_VALUE } from '@/components/data-table/dataTableStyles';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { useVrchatLogController } from '../useVrchatLogController';
import {
    buildLogHighlightMatcher,
    entryMessageText,
    entryToText,
    levelClassName,
    LOG_HEADER_HEIGHT,
    LOG_LOAD_OLDER_HEIGHT,
    LOG_ROW_HEIGHT,
    LOG_TABLE_GRID_CLASS,
    splitLogHighlight
} from '../vrchatLogHelpers';

type VrchatLogController = ReturnType<typeof useVrchatLogController>;
type VrchatLogTableProps = Pick<
    VrchatLogController,
    | 'setLogScrollNode'
    | 'logBodyOffset'
    | 'logVirtualHeight'
    | 'visibleLogRows'
    | 'selectedLineNumbers'
    | 'toggleEntrySelected'
    | 'copyText'
    | 'copySelectedEntries'
    | 'selectedCount'
    | 'isCopying'
    | 'searchQuery'
    | 'searchCaseSensitive'
    | 'searchRegex'
    | 'olderOffset'
    | 'isLoadingMore'
> & {
    onLoadOlder: () => void;
};

export function VrchatLogTable({
    setLogScrollNode,
    logBodyOffset,
    logVirtualHeight,
    visibleLogRows,
    selectedLineNumbers,
    toggleEntrySelected,
    copyText,
    copySelectedEntries,
    selectedCount,
    isCopying,
    searchQuery,
    searchCaseSensitive,
    searchRegex,
    olderOffset,
    isLoadingMore,
    onLoadOlder
}: VrchatLogTableProps) {
    const { t } = useTranslation();
    const matcher = buildLogHighlightMatcher(searchQuery, {
        caseSensitive: searchCaseSensitive,
        useRegex: searchRegex
    });
    const canLoadOlder = olderOffset !== null;

    return (
        <div ref={setLogScrollNode} className="h-full overflow-auto">
            <div
                className="relative min-w-[980px]"
                style={{ height: `${logVirtualHeight}px` }}
            >
                <div
                    className={cn(
                        'bg-background/95 sticky top-0 z-10 grid h-[30px] items-center gap-2 border-b border-[var(--vrcx-0-table-divider)] px-2 text-xs text-[var(--vrcx-0-table-header-foreground)] backdrop-blur',
                        LOG_TABLE_GRID_CLASS
                    )}
                >
                    <div className="text-right">
                        {t('view.tools.vrchat_log.column_line')}
                    </div>
                    <div>{t('view.tools.vrchat_log.column_time')}</div>
                    <div>{t('view.tools.vrchat_log.column_level')}</div>
                    <div>{t('view.tools.vrchat_log.column_category')}</div>
                    <div>{t('view.tools.vrchat_log.column_message')}</div>
                </div>
                {canLoadOlder ? (
                    <div
                        className="absolute top-0 right-0 left-0 flex items-center justify-center px-2"
                        style={{
                            height: `${LOG_LOAD_OLDER_HEIGHT}px`,
                            transform: `translateY(${LOG_HEADER_HEIGHT}px)`
                        }}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={isLoadingMore}
                            onClick={onLoadOlder}
                        >
                            {isLoadingMore ? (
                                <Spinner className="size-3.5" />
                            ) : (
                                <ChevronUpIcon data-icon="inline-start" />
                            )}
                            {t('view.tools.vrchat_log.load_older')}
                        </Button>
                    </div>
                ) : null}
                {visibleLogRows.map((row) => {
                    const { entry } = row;
                    const categoryLabel =
                        entry.category || DATA_TABLE_EMPTY_VALUE;
                    const selected = selectedLineNumbers.has(entry.lineNumber);

                    return (
                        <ContextMenu key={row.key}>
                            <ContextMenuTrigger
                                render={
                                    <div
                                        role="checkbox"
                                        aria-checked={selected}
                                        tabIndex={0}
                                        style={{
                                            height: `${LOG_ROW_HEIGHT}px`,
                                            transform: `translateY(${row.start + logBodyOffset}px)`
                                        }}
                                        onClick={() => {
                                            toggleEntrySelected(
                                                entry,
                                                !selected
                                            );
                                        }}
                                        onKeyDown={(event) => {
                                            if (
                                                event.key !== 'Enter' &&
                                                event.key !== ' '
                                            ) {
                                                return;
                                            }
                                            event.preventDefault();
                                            toggleEntrySelected(
                                                entry,
                                                !selected
                                            );
                                        }}
                                        className={cn(
                                            'absolute top-0 right-0 left-0 grid cursor-default items-center gap-2 border-b border-[var(--vrcx-0-table-divider)] px-2 text-[13px] leading-5 hover:bg-[var(--vrcx-0-table-row-hover-surface)]',
                                            LOG_TABLE_GRID_CLASS,
                                            selected &&
                                                'before:bg-primary bg-[var(--vrcx-0-table-row-selected-surface)] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-[""] hover:bg-[var(--vrcx-0-table-row-selected-hover-surface)]'
                                        )}
                                    >
                                        <div className="text-muted-foreground/70 text-right tabular-nums">
                                            {entry.lineNumber}
                                        </div>
                                        <div className="text-muted-foreground whitespace-nowrap tabular-nums">
                                            {entry.timestamp}
                                        </div>
                                        <div>
                                            <Badge
                                                className={cn(
                                                    'h-5 px-2 text-[11px] font-semibold',
                                                    levelClassName(entry.level)
                                                )}
                                            >
                                                {entry.level}
                                            </Badge>
                                        </div>
                                        <div className="text-muted-foreground min-w-0">
                                            {entry.category ? (
                                                <Tooltip>
                                                    <TooltipTrigger
                                                        render={
                                                            <span className="block truncate">
                                                                {categoryLabel}
                                                            </span>
                                                        }
                                                    />
                                                    <TooltipContent className="max-w-md break-words">
                                                        {categoryLabel}
                                                    </TooltipContent>
                                                </Tooltip>
                                            ) : (
                                                <span className="block truncate">
                                                    {categoryLabel}
                                                </span>
                                            )}
                                        </div>
                                        <div
                                            className="text-foreground flex min-w-0 items-center gap-2"
                                            title={entryMessageText(entry)}
                                        >
                                            <span className="min-w-0 truncate">
                                                {splitLogHighlight(
                                                    entry.message,
                                                    matcher
                                                ).map((segment, index) => (
                                                    <Fragment key={index}>
                                                        {segment.match ? (
                                                            <mark className="bg-primary/25 text-foreground rounded-sm">
                                                                {segment.text}
                                                            </mark>
                                                        ) : (
                                                            segment.text
                                                        )}
                                                    </Fragment>
                                                ))}
                                            </span>
                                            {entry.continuationLines.length ? (
                                                <Badge className="bg-muted text-muted-foreground h-5 shrink-0 px-1.5 text-[11px] font-medium">
                                                    {t(
                                                        'view.tools.vrchat_log.continuation_count',
                                                        {
                                                            count: entry
                                                                .continuationLines
                                                                .length
                                                        }
                                                    )}
                                                </Badge>
                                            ) : null}
                                        </div>
                                    </div>
                                }
                            />
                            <ContextMenuContent>
                                <ContextMenuItem
                                    onClick={() => {
                                        copyText(entryToText(entry));
                                    }}
                                >
                                    <ClipboardCopyIcon />
                                    {t('view.tools.vrchat_log.copy_entry')}
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onClick={() => {
                                        copyText(entryMessageText(entry));
                                    }}
                                >
                                    <ClipboardCopyIcon />
                                    {t('view.tools.vrchat_log.copy_message')}
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                    disabled={!selectedCount || isCopying}
                                    onClick={copySelectedEntries}
                                >
                                    <ClipboardCopyIcon />
                                    {t('view.tools.vrchat_log.copy_selected')}
                                </ContextMenuItem>
                            </ContextMenuContent>
                        </ContextMenu>
                    );
                })}
            </div>
        </div>
    );
}
