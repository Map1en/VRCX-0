import {
    ArrowUpRightIcon,
    CopyIcon,
    MoreHorizontalIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { normalizeLocationText } from '@/components/location/locationModel';
import { StaticLocation } from '@/components/location/StaticLocation';
import { LocationWorld } from '@/components/LocationWorld';
import {
    formatCompactDateTime,
    formatDateFilterOrFallback
} from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import gameLogRepository from '@/repositories/gameLogRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    type PreviousInstanceRow,
    rowDuration,
    rowLocation,
    rowLocationObject,
    rowMatchesSearch,
    sortPreviousInstanceRows
} from './previousInstancesRows';
import {
    DialogEmptyState,
    PreviousInstanceDetailsPanel
} from './PreviousInstancesViewParts';

export type InstanceHistoryListVariant = 'user' | 'world';

const ENTER_FORWARD =
    'animate-in fade-in-0 slide-in-from-right-1 duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:slide-in-from-right-0';
const ENTER_BACK =
    'animate-in fade-in-0 slide-in-from-left-1 duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:slide-in-from-left-0';

function InstanceHistoryRowLocation({
    row,
    variant
}: {
    row: PreviousInstanceRow;
    variant: InstanceHistoryListVariant;
}) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const location = rowLocation(row);
    if (!location) {
        return '-';
    }
    if (variant === 'world') {
        const locationObject = rowLocationObject(row);
        return (
            <LocationWorld
                locationObject={locationObject}
                grouphint={row?.groupName}
                currentUserId={currentUserId}
                worldDialogShortName={normalizeLocationText(
                    locationObject.shortName
                )}
                instanceOwner={
                    locationObject.ownerUserId || locationObject.userId || ''
                }
                instanceOwnerName={normalizeLocationText(
                    locationObject.ownerDisplayName ||
                        row?.ownerDisplayName ||
                        row?.ownerName
                )}
                interactive={false}
                hint={row?.worldName || ''}
                className="max-w-full"
            />
        );
    }
    return (
        <StaticLocation
            location={location}
            hint={row?.worldName || ''}
            showGroupLink={false}
            disableTooltip
        />
    );
}

function InstanceHistoryListRow<TRow extends PreviousInstanceRow>({
    row,
    variant,
    onOpenDetails,
    onCopyLocation,
    onDelete
}: {
    row: TRow;
    variant: InstanceHistoryListVariant;
    onOpenDetails: (row: TRow) => void;
    onCopyLocation: (row: TRow) => void;
    onDelete: (row: TRow) => void;
}) {
    const { t } = useTranslation();
    const location = rowLocation(row);
    const createdAt = row?.created_at || row?.createdAt;

    return (
        <div className="relative flex min-h-9 items-center gap-3 rounded-md px-2 text-xs">
            <button
                type="button"
                onClick={() => onOpenDetails(row)}
                aria-label={t(
                    'dialog.previous_instances.description.open_instance_details'
                )}
                className="focus-visible:ring-ring/50 absolute inset-0 rounded-md transition-colors duration-[120ms] outline-none hover:bg-(--state-hover-surface) focus-visible:ring-2 motion-reduce:transition-none"
            />
            <span
                className="text-muted-foreground pointer-events-none relative w-28 shrink-0 tabular-nums"
                title={formatDateFilterOrFallback(createdAt, 'long')}
            >
                {formatCompactDateTime(createdAt) || '-'}
            </span>
            <div className="pointer-events-none relative min-w-0 flex-1">
                <InstanceHistoryRowLocation row={row} variant={variant} />
            </div>
            <span className="pointer-events-none relative w-14 shrink-0 text-right tabular-nums">
                {rowDuration(row)}
            </span>
            <div className="relative flex shrink-0 items-center gap-0.5">
                <InstanceActionBar
                    target={{
                        location,
                        worldName: row?.worldName || ''
                    }}
                    actionVariant="ghost"
                    showRefresh={false}
                    showInstanceInfo={false}
                />
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t(
                                    'dialog.previous_instances.action.more_actions'
                                )}
                            >
                                <MoreHorizontalIcon data-icon="icon" />
                            </Button>
                        }
                    />
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            disabled={!location}
                            onClick={() => onCopyLocation(row)}
                        >
                            <CopyIcon />
                            {t(
                                'dialog.previous_instances.action.copy_instance_id'
                            )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={!location}
                            onClick={() => onDelete(row)}
                        >
                            <Trash2Icon />
                            {t('common.actions.delete')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

export function InstanceHistoryListPanel<TRow extends PreviousInstanceRow>({
    instances = [],
    variant,
    truncatedLimit = null,
    onRowsChange = null,
    onOpenFullHistory = null,
    className = ''
}: {
    className?: string;
    instances?: TRow[];
    onOpenFullHistory?: ((search: string) => void) | null;
    onRowsChange?: ((rows: TRow[]) => void) | null;
    truncatedLimit?: number | null;
    variant: InstanceHistoryListVariant;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const [rows, setRows] = useState<TRow[]>([]);
    const [search, setSearch] = useState('');
    const [detailRow, setDetailRow] = useState<TRow | null>(null);
    const [enterClassName, setEnterClassName] = useState('');

    useEffect(() => {
        setRows(instances);
        setSearch('');
        setDetailRow(null);
        setEnterClassName('');
    }, [instances]);

    const query = search.trim();
    const visibleRows = useMemo(() => {
        const nextRows = query
            ? rows.filter((row) => rowMatchesSearch(row, query))
            : rows;
        return sortPreviousInstanceRows(nextRows, 'date', true);
    }, [rows, query]);

    const isTruncated =
        truncatedLimit !== null && rows.length >= truncatedLimit;
    const openFullLabel = t('view.instance_history.action.open_full');

    function openDetails(row: TRow) {
        setEnterClassName(ENTER_FORWARD);
        setDetailRow(row);
    }

    function closeDetails() {
        setEnterClassName(ENTER_BACK);
        setDetailRow(null);
    }

    function copyLocation(row: TRow) {
        const location = rowLocation(row);
        if (!location) {
            return;
        }
        void copyTextToClipboard(location, {
            successMessage: t(
                'dialog.previous_instances.success.instance_id_copied'
            ),
            errorMessage: t(
                'dialog.previous_instances.error.failed_to_copy_instance_id'
            )
        });
    }

    async function deleteRow(row: TRow) {
        const location = rowLocation(row);
        if (!location) {
            return;
        }
        const result = await confirm({
            title: t(
                'dialog.previous_instances_table.modal.delete_instance_record'
            ),
            description: location,
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        if (
            variant === 'user' &&
            (!Array.isArray(row.events) || row.events.length === 0)
        ) {
            toast.add({
                type: 'error',
                title: t(
                    'dialog.previous_instances.error.this_user_instance_row_cannot_be_deleted_without_event_ids'
                )
            });
            return;
        }

        try {
            if (variant === 'user') {
                await gameLogRepository.deleteGameLogInstance({
                    location,
                    events: row.events
                });
            } else {
                await gameLogRepository.deleteGameLogInstanceByInstanceId({
                    location
                });
            }
            const nextRows = rows.filter((item) => item !== row);
            setRows(nextRows);
            onRowsChange?.(nextRows);
            setDetailRow((current) => (current === row ? null : current));
            toast.add({
                type: 'success',
                title: t(
                    'dialog.previous_instances.success.instance_record_deleted'
                )
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.previous_instances_table.toast.failed_to_delete_instance_record'
                          )
            });
        }
    }

    if (detailRow) {
        return (
            <div
                className={cn(
                    'flex min-h-0 flex-col',
                    className,
                    enterClassName
                )}
            >
                <PreviousInstanceDetailsPanel
                    row={detailRow}
                    onBack={closeDetails}
                    className="flex-1"
                />
            </div>
        );
    }

    return (
        <div
            className={cn(
                'flex min-h-0 flex-col gap-3',
                className,
                enterClassName
            )}
        >
            <div className="flex items-center gap-2">
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t(
                        'dialog.previous_instances.search_placeholder'
                    )}
                    className="max-w-sm"
                />
                {onOpenFullHistory ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    className="ml-auto"
                                    aria-label={openFullLabel}
                                    onClick={() => onOpenFullHistory(query)}
                                >
                                    <ArrowUpRightIcon className="size-4" />
                                </Button>
                            }
                        />
                        <TooltipContent>{openFullLabel}</TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            {visibleRows.length ? (
                <div className="max-h-[33rem] min-h-0 flex-1 overflow-auto rounded-md border p-1">
                    {visibleRows.map((row, index) => (
                        <InstanceHistoryListRow
                            key={`${rowLocation(row)}:${row?.id || row?.created_at || row?.createdAt || index}`}
                            row={row}
                            variant={variant}
                            onOpenDetails={openDetails}
                            onCopyLocation={copyLocation}
                            onDelete={deleteRow}
                        />
                    ))}
                </div>
            ) : (
                <DialogEmptyState
                    title={t(
                        'dialog.previous_instances.empty.no_instance_records'
                    )}
                    description={
                        query ? t('empty_state.search_no_results') : undefined
                    }
                    className="min-h-40 flex-none"
                />
            )}
            {isTruncated && onOpenFullHistory ? (
                <button
                    type="button"
                    onClick={() => onOpenFullHistory(query)}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-md text-center text-xs transition-colors duration-[120ms] outline-none focus-visible:ring-2 motion-reduce:transition-none"
                >
                    {query
                        ? t(
                              'dialog.previous_instances.label.search_limited_to_recent',
                              { count: rows.length }
                          )
                        : t(
                              'dialog.previous_instances.label.showing_recent_only',
                              { count: rows.length }
                          )}
                </button>
            ) : null}
        </div>
    );
}
