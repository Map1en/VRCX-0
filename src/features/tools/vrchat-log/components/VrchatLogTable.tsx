import { ClipboardCopyIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    entryMessageText,
    entryToText,
    levelClassName,
    LOG_HEADER_HEIGHT,
    LOG_ROW_HEIGHT,
    LOG_TABLE_GRID_CLASS
} from '../vrchatLogHelpers';

export function VrchatLogTable({
    setLogScrollNode,
    logVirtualHeight,
    visibleLogRows,
    selectedLineNumbers,
    toggleEntrySelected,
    copyText,
    copySelectedEntries,
    selectedCount,
    isCopying
}: any) {
    const { t } = useTranslation();

    return (
        <div ref={setLogScrollNode} className="h-full overflow-auto">
            <div
                className="relative min-w-[980px]"
                style={{ height: `${logVirtualHeight}px` }}
            >
                <div
                    className={cn(
                        'border-border bg-background/95 text-muted-foreground sticky top-0 z-10 grid h-[30px] items-center gap-2 border-b px-2 text-[11px] font-medium uppercase backdrop-blur',
                        LOG_TABLE_GRID_CLASS
                    )}
                >
                    <div />
                    <div>{t('view.tools.vrchat_log.column_time')}</div>
                    <div>{t('view.tools.vrchat_log.column_level')}</div>
                    <div>{t('view.tools.vrchat_log.column_category')}</div>
                    <div>{t('view.tools.vrchat_log.column_message')}</div>
                </div>
                {visibleLogRows.map((row: any) => {
                    const { entry } = row;
                    const categoryLabel =
                        entry.category ||
                        t('view.tools.vrchat_log.no_category');
                    const selected = selectedLineNumbers.has(entry.lineNumber);

                    return (
                        <ContextMenu key={row.key}>
                            <ContextMenuTrigger
                                render={
                                    <div
                                        style={{
                                            height: `${LOG_ROW_HEIGHT}px`,
                                            transform: `translateY(${row.start + LOG_HEADER_HEIGHT}px)`
                                        }}
                                        onClick={(event) => {
                                            const target =
                                                event.target as HTMLElement;
                                            if (
                                                target.closest(
                                                    '[data-log-select-control]'
                                                )
                                            ) {
                                                return;
                                            }
                                            toggleEntrySelected(
                                                entry,
                                                !selected
                                            );
                                        }}
                                        className={cn(
                                            'border-border hover:bg-accent/25 absolute top-0 right-0 left-0 grid cursor-default items-center gap-2 border-b px-2 text-[13px] leading-5',
                                            LOG_TABLE_GRID_CLASS,
                                            selected && 'bg-accent/30'
                                        )}
                                    >
                                        <div
                                            className="flex justify-center"
                                            data-log-select-control
                                        >
                                            <Checkbox
                                                checked={selected}
                                                onCheckedChange={(checked) =>
                                                    toggleEntrySelected(
                                                        entry,
                                                        checked === true
                                                    )
                                                }
                                            />
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
                                                {entry.message}
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
