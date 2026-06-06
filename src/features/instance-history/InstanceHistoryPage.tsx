import {
    CalendarRangeIcon,
    ChevronsUpDownIcon,
    RefreshCwIcon,
    UserRoundIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { PreviousInstancesListTable } from '@/components/dialogs/previous-instances-table/PreviousInstancesListTable';
import {
    formatPreviousInstanceCount,
    createdTime,
    rowLocation,
    rowSearchText,
    sortPreviousInstanceRows
} from '@/components/dialogs/previous-instances-table/previousInstancesRows';
import { PreviousInstanceDetailsPanel } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import {
    PageBody,
    PageDescription,
    PageHeader,
    PageScaffold,
    PageTitle,
    PageToolbar,
    PageToolbarRow
} from '@/components/layout/PageScaffold';
import { UserPickerRow } from '@/features/charts/components/MutualFriendsViewParts';
import {
    parseGameLogDateInput,
    toGameLogDateInputValue
} from '@/features/game-log/gameLogDateRange';
import { normalizeEndpoint, normalizeUserId } from '@/domain/users/userFacts';
import gameLogRepository from '@/repositories/gameLogRepository';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';
import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Spinner } from '@/ui/shadcn/spinner';

function rowsFromResult(result: any) {
    if (result instanceof Set || result instanceof Map) {
        return Array.from(result.values());
    }
    return Array.isArray(result) ? result : [];
}

function knownUserName(user: any) {
    return user?.displayName || user?.username || user?.name || '';
}

function dateRangeContains(row: any, dateFrom: any, dateTo: any) {
    if (!dateFrom && !dateTo) {
        return true;
    }
    const value = createdTime(row);
    if (!value) {
        return false;
    }
    const fromDate = parseGameLogDateInput(dateFrom);
    if (fromDate) {
        fromDate.setHours(0, 0, 0, 0);
        if (value < fromDate.getTime()) {
            return false;
        }
    }
    const toDate = parseGameLogDateInput(dateTo);
    if (toDate) {
        toDate.setHours(23, 59, 59, 999);
        if (value > toDate.getTime()) {
            return false;
        }
    }
    return true;
}

export function InstanceHistoryPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const confirm = useModalStore((state: any) => state.confirm);
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserDisplayName = useRuntimeStore(
        (state: any) => state.auth.currentUserDisplayName
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const usersByKey = useUserFactsStore((state: any) => state.usersByKey);
    const [targetPickerOpen, setTargetPickerOpen] = useState(false);
    const [targetSearch, setTargetSearch] = useState('');
    const [rows, setRows] = useState<any[]>([]);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [dateFilterOpen, setDateFilterOpen] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [dateDraftRange, setDateDraftRange] = useState<any>(undefined);
    const [sortKey, setSortKey] = useState('date');
    const [sortDesc, setSortDesc] = useState(true);
    const [pageSize, setPageSize] = useState(25);
    const [pageIndex, setPageIndex] = useState(0);
    const [detailRow, setDetailRow] = useState<any>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const endpoint = normalizeEndpoint(currentEndpoint);
    const paramUserId = normalizeUserId(searchParams.get('id'));
    const activeUserId = paramUserId || normalizeUserId(currentUserId);

    const knownUsers = useMemo(() => {
        const usersById = new Map();
        if (currentUserId) {
            usersById.set(currentUserId, {
                id: currentUserId,
                displayName: currentUserDisplayName,
                endpoint
            });
        }
        for (const user of Object.values(usersByKey || {}).filter((user: any) => {
            const userId = normalizeUserId(user?.id);
            return (
                userId &&
                normalizeEndpoint(user?.endpoint || endpoint) === endpoint
            );
        })) {
            const userId = normalizeUserId((user as any)?.id);
            if (!usersById.has(userId)) {
                usersById.set(userId, user);
            }
        }
        return Array.from(usersById.values())
            .sort((left: any, right: any) =>
                (knownUserName(left) || left?.id || '').localeCompare(
                    knownUserName(right) || right?.id || ''
                )
            )
            .slice(0, 500);
    }, [currentUserDisplayName, currentUserId, endpoint, usersByKey]);

    const activeKnownUser: any = useMemo(
        () =>
            knownUsers.find(
                (user: any) => normalizeUserId(user?.id) === activeUserId
            ) || null,
        [activeUserId, knownUsers]
    );

    const activeUserLabel =
        (activeUserId && activeUserId === normalizeUserId(currentUserId)
            ? t('view.instance_history.label.self')
            : knownUserName(activeKnownUser)) ||
        (activeUserId === currentUserId ? currentUserDisplayName : '') ||
        t('view.instance_history.label.selected_user');

    const targetOptions = useMemo(() => {
        const query = targetSearch.trim().toLowerCase();
        return knownUsers
            .map((user: any) => ({
                value: normalizeUserId(user?.id),
                label:
                    normalizeUserId(user?.id) === normalizeUserId(currentUserId)
                        ? t('view.instance_history.label.self')
                        : knownUserName(user) ||
                          t('view.instance_history.label.unnamed_user'),
                user
            }))
            .filter((option: any) => {
                if (!option.value) {
                    return false;
                }
                if (!query) {
                    return true;
                }
                return (
                    option.label.toLowerCase().includes(query) ||
                    option.value.toLowerCase().includes(query)
                );
            });
    }, [currentUserId, knownUsers, targetSearch, t]);

    useEffect(() => {
        setPageIndex(0);
    }, [dateFrom, dateTo, search, sortDesc, sortKey]);

    useEffect(() => {
        if (!activeUserId) {
            setRows([]);
            setStatus('idle');
            setError('');
            setDetailRow(null);
            return undefined;
        }

        let active = true;
        setStatus('running');
        setError('');
        setDetailRow(null);

        gameLogRepository
            .getPreviousInstancesByUserId({ id: activeUserId })
            .then((result: any) => {
                if (!active) {
                    return;
                }
                setRows(rowsFromResult(result));
                setStatus('ready');
            })
            .catch((loadError: any) => {
                if (!active) {
                    return;
                }
                setRows([]);
                setStatus('error');
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : t(
                              'view.instance_history.toast.failed_to_load_instance_history'
                          )
                );
            });

        return () => {
            active = false;
        };
    }, [activeUserId, reloadToken, t]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        const dateRows = rows.filter((row: any) =>
            dateRangeContains(row, dateFrom, dateTo)
        );
        const nextRows = query
            ? dateRows.filter((row: any) => rowSearchText(row).includes(query))
            : dateRows;
        return sortPreviousInstanceRows(nextRows, sortKey, sortDesc);
    }, [dateFrom, dateTo, rows, search, sortDesc, sortKey]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );

    function changeSort(nextKey: any) {
        if (nextKey === sortKey) {
            if (!sortDesc) {
                setSortKey('');
                setSortDesc(true);
                return;
            }
            setSortDesc((value: any) => !value);
            return;
        }
        setSortKey(nextKey);
        setSortDesc(nextKey === 'date');
    }

    function applyTarget(value: any) {
        const nextUserId = normalizeUserId(value);
        if (!nextUserId) {
            return;
        }
        if (nextUserId === normalizeUserId(currentUserId)) {
            setSearchParams({});
            return;
        }
        setSearchParams({ scope: 'user', id: nextUserId });
    }

    function refresh() {
        if (!activeUserId) {
            return;
        }
        setReloadToken((value: any) => value + 1);
    }

    function updateDateDraftRange(range: any) {
        setDateDraftRange(range);
    }

    function applyDateRange() {
        const from = dateDraftRange?.from
            ? toGameLogDateInputValue(dateDraftRange.from)
            : '';
        const to = dateDraftRange?.to
            ? toGameLogDateInputValue(dateDraftRange.to)
            : from;
        setDateFrom(from);
        setDateTo(to);
        setDateFilterOpen(false);
    }

    function clearDateRange() {
        setDateFrom('');
        setDateTo('');
        setDateDraftRange(undefined);
        setDateFilterOpen(false);
    }

    const dateRangeLabel =
        dateFrom || dateTo
            ? [dateFrom || '...', dateTo || '...'].join(' - ')
            : t('view.instance_history.label.date_range');

    const dateRangeControl = (
        <Popover open={dateFilterOpen} onOpenChange={setDateFilterOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant={dateFrom || dateTo ? 'secondary' : 'outline'}
                >
                    <CalendarRangeIcon data-icon="inline-start" />
                    <span>{dateRangeLabel}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto">
                <Calendar
                    mode="range"
                    numberOfMonths={2}
                    selected={dateDraftRange}
                    disabled={{ after: new Date() }}
                    onSelect={updateDateDraftRange}
                />
                <div className="flex items-center justify-between gap-4 px-3 pb-3">
                    <div className="text-muted-foreground min-w-0 text-xs">
                        {[
                            dateDraftRange?.from
                                ? toGameLogDateInputValue(dateDraftRange.from)
                                : '...',
                            dateDraftRange?.to
                                ? toGameLogDateInputValue(dateDraftRange.to)
                                : '...'
                        ].join(' - ')}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={clearDateRange}
                        >
                            {t('common.actions.clear')}
                        </Button>
                        <Button type="button" size="sm" onClick={applyDateRange}>
                            {t('common.actions.confirm')}
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );

    async function deleteRow(row: any) {
        const location = rowLocation(row);
        if (!location || !activeUserId) {
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
        if (!Array.isArray(row.events) || row.events.length === 0) {
            toast.error(
                t(
                    'dialog.previous_instances.error.this_user_instance_row_cannot_be_deleted_without_event_ids'
                )
            );
            return;
        }
        try {
            await gameLogRepository.deleteGameLogInstance({
                id: activeUserId,
                location,
                events: row.events
            });
            setRows((currentRows: any[]) =>
                currentRows.filter((item: any) => item !== row)
            );
            setDetailRow((current: any) => (current === row ? null : current));
            toast.success(
                t('dialog.previous_instances.success.instance_record_deleted')
            );
        } catch (deleteError) {
            toast.error(
                deleteError instanceof Error
                    ? deleteError.message
                    : t(
                          'dialog.previous_instances_table.toast.failed_to_delete_instance_record'
                      )
            );
        }
    }

    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <PageHeader className="p-0">
                    <PageTitle>{t('view.instance_history.title')}</PageTitle>
                    <PageDescription>
                        {activeUserId
                            ? t('view.instance_history.description.viewing', {
                                  name: activeUserLabel
                              })
                            : t(
                                  'view.instance_history.description.no_current_user'
                              )}
                    </PageDescription>
                </PageHeader>
                <PageToolbarRow>
                    <Popover
                        open={targetPickerOpen}
                        onOpenChange={setTargetPickerOpen}
                    >
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                className="min-w-64 max-w-xl flex-1 justify-between"
                            >
                                <span className="truncate">{activeUserLabel}</span>
                                <ChevronsUpDownIcon className="text-muted-foreground size-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-96 p-2">
                            <div className="flex flex-col gap-2">
                                <Input
                                    value={targetSearch}
                                    onChange={(event: any) =>
                                        setTargetSearch(event.target.value)
                                    }
                                    placeholder={t(
                                        'view.instance_history.placeholder.user'
                                    )}
                                />
                                <ScrollArea className="h-72 rounded-md border">
                                    <div className="flex flex-col gap-1 p-1 pr-2">
                                        {targetOptions.map((option: any) => (
                                            <Button
                                                key={option.value}
                                                type="button"
                                                variant="ghost"
                                                className="h-auto justify-start p-0"
                                                onClick={() => {
                                                    applyTarget(option.value);
                                                    setTargetPickerOpen(false);
                                                }}
                                            >
                                                <UserPickerRow
                                                    option={option}
                                                    selected={
                                                        option.value ===
                                                        activeUserId
                                                    }
                                                />
                                            </Button>
                                        ))}
                                        {!targetOptions.length ? (
                                            <div className="text-muted-foreground p-3 text-xs">
                                                {t('common.search_no_results')}
                                            </div>
                                        ) : null}
                                    </div>
                                </ScrollArea>
                            </div>
                        </PopoverContent>
                    </Popover>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!currentUserId}
                        onClick={() => applyTarget(currentUserId)}
                    >
                        <UserRoundIcon data-icon="inline-start" />
                        {t('view.instance_history.action.current_user')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!activeUserId || status === 'running'}
                        onClick={refresh}
                    >
                        {status === 'running' ? (
                            <Spinner className="size-4" />
                        ) : (
                            <RefreshCwIcon data-icon="inline-start" />
                        )}
                        {t('common.actions.refresh')}
                    </Button>
                </PageToolbarRow>
                {status === 'error' ? (
                    <div className="text-destructive text-sm">{error}</div>
                ) : null}
            </PageToolbar>
            <PageBody>
                <ResizablePanelGroup
                    id="instance-history-layout"
                    orientation="horizontal"
                    className="min-h-0 flex-1"
                >
                    <ResizablePanel
                        id="instance-history-list"
                        defaultSize={62}
                        minSize={45}
                        className="min-h-0 min-w-0 pr-3"
                    >
                        <PreviousInstancesListTable
                            title={t('view.instance_history.title')}
                            rows={rows}
                            filteredRows={filteredRows}
                            visibleRows={visibleRows}
                            variant="user"
                            showHeader
                            className="h-full min-h-0"
                            search={search}
                            onSearchChange={(value: any) => {
                                setSearch(value);
                                setPageIndex(0);
                            }}
                            pageSize={pageSize}
                            onPageSizeChange={(value: any) => {
                                setPageSize(value);
                                setPageIndex(0);
                            }}
                            sortKey={sortKey}
                            sortDesc={sortDesc}
                            onSortChange={changeSort}
                            currentPageIndex={currentPageIndex}
                            totalPages={totalPages}
                            onPreviousPage={() =>
                                setPageIndex((value: any) =>
                                    Math.max(0, value - 1)
                                )
                            }
                            onNextPage={() =>
                                setPageIndex((value: any) =>
                                    Math.min(totalPages - 1, value + 1)
                                )
                            }
                            currentUserId={currentUserId}
                            currentEndpoint={currentEndpoint}
                            onOpenDetails={setDetailRow}
                            onDeleteRow={deleteRow}
                            searchActions={dateRangeControl}
                        />
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                        id="instance-history-details"
                        defaultSize={38}
                        minSize={28}
                        className="min-h-0 min-w-0 pl-3"
                    >
                        <PreviousInstanceDetailsPanel
                            row={detailRow}
                            showTitle
                            className="h-full min-h-0"
                        />
                    </ResizablePanel>
                </ResizablePanelGroup>
                {status === 'ready' ? (
                    <div className="text-muted-foreground shrink-0 text-xs">
                        {t('view.instance_history.label.loaded_records', {
                            count: formatPreviousInstanceCount(rows.length)
                        })}
                    </div>
                ) : null}
            </PageBody>
        </PageScaffold>
    );
}
