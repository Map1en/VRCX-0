import {
    LayoutDashboardIcon,
    PlusIcon,
    SaveIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { DashboardPanelPreview } from '@/components/dashboard/DashboardPanelPreview.jsx';
import {
    createDashboardPanelValue,
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    getDashboardPanelDefinition,
    resolveDashboardPanelKey
} from '@/components/dashboard/dashboardRegistry.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import { generateDashboardRowId } from '@/repositories/dashboardRepository.js';
import {
    FEED_FILTER_TYPES,
    GAME_LOG_FILTER_TYPES
} from '@/repositories/index.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import {
    cloneDashboardRows,
    createDashboardPanelSelectOptions,
    createDashboardWidgetPanelValue,
    getDashboardFilterList,
    getDashboardPanelConfig,
    getDashboardRowKey,
    getKnownDashboardInstanceWidgetColumns,
    getNextDashboardFilterConfig,
    getNextDashboardInstanceColumnConfig,
    isDashboardFilterActive
} from './dashboardConfig.js';

function DashboardFilterConfig({ title, filterTypes, config, onConfigChange }) {
    const filters = getDashboardFilterList(config);

    return (
        <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {title}
            </div>
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant={filters.length === 0 ? 'default' : 'outline'}
                    onClick={() => onConfigChange({ ...config, filters: [] })}
                >
                    All
                </Button>
                {filterTypes.map((filterType) => (
                    <Button
                        key={filterType}
                        type="button"
                        size="sm"
                        variant={
                            isDashboardFilterActive(config, filterType)
                                ? 'default'
                                : 'outline'
                        }
                        onClick={() =>
                            onConfigChange(
                                getNextDashboardFilterConfig(
                                    config,
                                    filterType,
                                    filterTypes
                                )
                            )
                        }
                    >
                        {filterType}
                    </Button>
                ))}
            </div>
        </div>
    );
}

function DashboardSwitchConfig({
    label,
    description,
    checked,
    onCheckedChange
}) {
    return (
        <div className="bg-muted/10 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {description ? (
                    <div className="text-muted-foreground text-xs">
                        {description}
                    </div>
                ) : null}
            </div>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}

function DashboardInstanceColumnConfig({ config, onConfigChange }) {
    const activeColumns = getKnownDashboardInstanceWidgetColumns(config);

    return (
        <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Visible columns
            </div>
            <div className="flex flex-wrap gap-2">
                {DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map((column) => (
                    <Button
                        key={column.key}
                        type="button"
                        size="sm"
                        variant={
                            activeColumns.includes(column.key)
                                ? 'default'
                                : 'outline'
                        }
                        disabled={column.required}
                        onClick={() =>
                            onConfigChange(
                                getNextDashboardInstanceColumnConfig(
                                    config,
                                    column.key
                                )
                            )
                        }
                    >
                        {column.label}
                    </Button>
                ))}
            </div>
        </div>
    );
}

function DashboardWidgetConfigEditor({ panelKey, config, onConfigChange }) {
    if (panelKey === 'widget:feed') {
        return (
            <div className="flex flex-col gap-3">
                <DashboardFilterConfig
                    title="Feed filters"
                    filterTypes={FEED_FILTER_TYPES}
                    config={config}
                    onConfigChange={onConfigChange}
                />
                <DashboardSwitchConfig
                    label="Show type column"
                    description="Matches the stored feed widget config."
                    checked={Boolean(config.showType)}
                    onCheckedChange={(checked) =>
                        onConfigChange({
                            ...config,
                            showType: Boolean(checked)
                        })
                    }
                />
            </div>
        );
    }

    if (panelKey === 'widget:game-log') {
        return (
            <div className="flex flex-col gap-3">
                <DashboardFilterConfig
                    title="Game-log filters"
                    filterTypes={GAME_LOG_FILTER_TYPES}
                    config={config}
                    onConfigChange={onConfigChange}
                />
                <DashboardSwitchConfig
                    label="Show detail"
                    description="Expands the compact game-log description."
                    checked={Boolean(config.showDetail)}
                    onCheckedChange={(checked) =>
                        onConfigChange({
                            ...config,
                            showDetail: Boolean(checked)
                        })
                    }
                />
            </div>
        );
    }

    if (panelKey === 'widget:instance') {
        return (
            <DashboardInstanceColumnConfig
                config={config}
                onConfigChange={onConfigChange}
            />
        );
    }

    return null;
}

function DashboardPanelSelectorDialog({
    open,
    currentPanelKey,
    onOpenChange,
    onSelect
}) {
    const options = useMemo(
        () => createDashboardPanelSelectOptions(currentPanelKey),
        [currentPanelKey]
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Select panel</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto">
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="text-muted-foreground h-auto justify-start border-dashed p-3 text-left font-normal whitespace-normal"
                            onClick={() => onSelect('__none__')}
                        >
                            Not configured
                        </Button>
                        {options.map((option) => {
                            const definition = getDashboardPanelDefinition(
                                option.value
                            );
                            const selected = option.value === currentPanelKey;
                            return (
                                <Button
                                    key={option.value}
                                    type="button"
                                    variant={selected ? 'secondary' : 'outline'}
                                    className="h-auto flex-col items-start justify-start p-3 text-left font-normal whitespace-normal"
                                    onClick={() => onSelect(option.value)}
                                >
                                    <div className="truncate text-sm font-medium">
                                        {definition?.label || option.label}
                                    </div>
                                    <div className="text-muted-foreground line-clamp-2 text-xs">
                                        {definition?.description ||
                                            option.value}
                                    </div>
                                </Button>
                            );
                        })}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function DashboardEditorPanel({
    panel,
    onChange,
    onRemove,
    showRemove = true
}) {
    const [selectorOpen, setSelectorOpen] = useState(false);
    const panelKey = resolveDashboardPanelKey(panel) ?? '__none__';
    const panelDefinition = getDashboardPanelDefinition(panelKey);
    const panelConfig = getDashboardPanelConfig(panel);
    const canConfigure = Boolean(panelDefinition?.category === 'widget');

    function updatePanelConfig(nextConfig) {
        if (!canConfigure || panelKey === '__none__') {
            return;
        }
        onChange(createDashboardWidgetPanelValue(panelKey, nextConfig));
    }

    return (
        <div className="bg-card relative flex min-h-0 flex-1 overflow-hidden rounded-md border">
            {showRemove ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1 right-1 z-20"
                    aria-label="Remove panel"
                    onClick={onRemove}
                >
                    <XIcon data-icon="inline-start" />
                </Button>
            ) : null}
            <div className="flex min-h-0 w-full flex-col items-center justify-center gap-3 p-3">
                {panelKey !== '__none__' ? (
                    <div className="flex w-full flex-col gap-3">
                        <div className="text-muted-foreground flex items-center justify-center gap-2 text-base">
                            <span>{panelDefinition?.label || panelKey}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Clear panel"
                                onClick={() => onChange(null)}
                            >
                                <Trash2Icon data-icon="inline-start" />
                            </Button>
                        </div>
                        {canConfigure ? (
                            <DashboardWidgetConfigEditor
                                panelKey={panelKey}
                                config={panelConfig}
                                onConfigChange={updatePanelConfig}
                            />
                        ) : null}
                    </div>
                ) : (
                    <>
                        <span className="text-muted-foreground text-base">
                            Panel not selected
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSelectorOpen(true)}
                        >
                            Select
                        </Button>
                    </>
                )}
            </div>
            {panelKey !== '__none__' ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="absolute bottom-2 left-1/2 -translate-x-1/2"
                    onClick={() => setSelectorOpen(true)}
                >
                    Select
                </Button>
            ) : null}
            <DashboardPanelSelectorDialog
                open={selectorOpen}
                currentPanelKey={panelKey}
                onOpenChange={setSelectorOpen}
                onSelect={(value) => {
                    onChange(createDashboardPanelValue(value));
                    setSelectorOpen(false);
                }}
            />
        </div>
    );
}

function DashboardEditorRow({
    row,
    rowIndex,
    onPanelChange,
    onPanelRemove,
    onRowRemove,
    onDirectionChange
}) {
    const direction = row?.direction === 'vertical' ? 'vertical' : 'horizontal';
    const panels = Array.isArray(row?.panels) ? row.panels : [];
    const panelEditClass =
        panels.length === 1
            ? 'w-full'
            : direction === 'vertical'
              ? 'h-1/2'
              : 'w-1/2';

    return (
        <div className="relative flex h-full min-h-[180px] flex-col gap-2 rounded-md border border-dashed p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Row {rowIndex + 1}
                </div>
                <div className="flex items-center gap-2">
                    {panels.length === 2 ? (
                        <Select
                            value={direction}
                            onValueChange={onDirectionChange}
                        >
                            <SelectTrigger size="sm" className="h-7 w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="horizontal">
                                        Horizontal
                                    </SelectItem>
                                    <SelectItem value="vertical">
                                        Vertical
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove row"
                        onClick={onRowRemove}
                    >
                        <Trash2Icon data-icon="inline-start" />
                    </Button>
                </div>
            </div>
            <div
                className={cn(
                    'flex min-h-[180px] gap-2',
                    direction === 'vertical' ? 'flex-col' : 'flex-row'
                )}
            >
                {panels.map((panel, panelIndex) => (
                    <div
                        key={`${rowIndex}-${panelIndex}`}
                        className={panelEditClass}
                    >
                        <DashboardEditorPanel
                            panel={panel}
                            onChange={(nextPanel) =>
                                onPanelChange(panelIndex, nextPanel)
                            }
                            onRemove={() => onPanelRemove(panelIndex)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function DashboardReadRow({ row, dashboardId, onPanelChange }) {
    const direction = row?.direction === 'vertical' ? 'vertical' : 'horizontal';
    const panels = Array.isArray(row?.panels) ? row.panels.slice(0, 2) : [];
    const rowKey = getDashboardRowKey(row);
    const firstPanelId = `dashboard-${dashboardId}-row-${rowKey}-panel-0`;
    const secondPanelId = `dashboard-${dashboardId}-row-${rowKey}-panel-1`;
    const rowLayout = useDefaultLayout({
        id: `dashboard-${dashboardId}-row-${rowKey}`,
        panelIds: [firstPanelId, secondPanelId]
    });

    if (panels.length === 2) {
        return (
            <div className="relative h-full min-h-[180px]">
                <ResizablePanelGroup
                    id={`dashboard-${dashboardId}-row-${rowKey}`}
                    orientation={direction}
                    className="h-full min-h-[180px]"
                    defaultLayout={rowLayout.defaultLayout}
                    onLayoutChanged={rowLayout.onLayoutChanged}
                >
                    <ResizablePanel
                        id={firstPanelId}
                        defaultSize="50%"
                        minSize="20%"
                    >
                        <div className="h-full min-h-[180px] min-w-0">
                            <DashboardPanelPreview
                                panel={panels[0]}
                                onPanelChange={(nextPanel) =>
                                    onPanelChange?.(0, nextPanel)
                                }
                            />
                        </div>
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel
                        id={secondPanelId}
                        defaultSize="50%"
                        minSize="20%"
                    >
                        <div className="h-full min-h-[180px] min-w-0">
                            <DashboardPanelPreview
                                panel={panels[1]}
                                onPanelChange={(nextPanel) =>
                                    onPanelChange?.(1, nextPanel)
                                }
                            />
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        );
    }

    return (
        <div className="relative h-full min-h-[180px]">
            <DashboardPanelPreview
                panel={panels[0]}
                onPanelChange={(nextPanel) => onPanelChange?.(0, nextPanel)}
            />
        </div>
    );
}

export function DashboardPage() {
    const { id = '' } = useParams();
    const navigate = useNavigate();
    const dashboards = useDashboardStore((state) => state.dashboards);
    const loaded = useDashboardStore((state) => state.loaded);
    const loadStatus = useDashboardStore((state) => state.loadStatus);
    const detail = useDashboardStore((state) => state.detail);
    const ensureLoaded = useDashboardStore((state) => state.ensureLoaded);
    const createDashboard = useDashboardStore((state) => state.createDashboard);
    const updateDashboard = useDashboardStore((state) => state.updateDashboard);
    const deleteDashboard = useDashboardStore((state) => state.deleteDashboard);
    const consumeEditingDashboardId = useDashboardStore(
        (state) => state.consumeEditingDashboardId
    );
    const setEditingDashboardId = useDashboardStore(
        (state) => state.setEditingDashboardId
    );
    const confirm = useModalStore((state) => state.confirm);

    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editRows, setEditRows] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [showAddRowOptions, setShowAddRowOptions] = useState(false);

    const dashboard = useMemo(
        () => dashboards.find((entry) => entry.id === id) || null,
        [dashboards, id]
    );
    const dashboardRowPanelIds = useMemo(
        () =>
            (Array.isArray(dashboard?.rows) ? dashboard.rows : []).map(
                (row) =>
                    `dashboard-${id}-row-panel-${getDashboardRowKey(row)}`
            ),
        [dashboard?.rows, id]
    );
    const dashboardLayout = useDefaultLayout({
        id: `dashboard-${id || 'empty'}`,
        panelIds: dashboardRowPanelIds
    });

    useEffect(() => {
        void ensureLoaded().catch(() => {});
    }, [ensureLoaded]);

    useEffect(() => {
        if (!loaded || !id) {
            return;
        }

        if (consumeEditingDashboardId(id)) {
            setIsEditing(true);
            return;
        }

        setIsEditing(false);
        setShowAddRowOptions(false);
    }, [consumeEditingDashboardId, id, loaded]);

    useEffect(() => {
        if (!dashboard) {
            setIsEditing(false);
            setEditName('');
            setEditRows([]);
            return;
        }

        setEditName(dashboard.name || '');
        setEditRows(cloneDashboardRows(dashboard.rows));
    }, [dashboard]);

    const handleAddRow = (panelCount, direction = 'horizontal') => {
        setEditRows((current) => [
            ...current,
            {
                id: generateDashboardRowId(),
                direction,
                panels: Array.from({ length: panelCount }, () => null)
            }
        ]);
        setShowAddRowOptions(false);
    };

    const handleUpdatePanel = (rowIndex, panelIndex, nextPanel) => {
        setEditRows((current) =>
            current.map((row, currentRowIndex) => {
                if (currentRowIndex !== rowIndex) {
                    return row;
                }

                const panels = Array.isArray(row?.panels)
                    ? row.panels.slice(0, 2)
                    : [];
                panels[panelIndex] = nextPanel;
                return {
                    ...row,
                    panels
                };
            })
        );
    };

    const handleRemovePanel = (rowIndex, panelIndex) => {
        setEditRows((current) =>
            current
                .map((row, currentRowIndex) => {
                    if (currentRowIndex !== rowIndex) {
                        return row;
                    }

                    const panels = Array.isArray(row?.panels)
                        ? row.panels.slice(0, 2)
                        : [];
                    panels.splice(panelIndex, 1);
                    return {
                        ...row,
                        panels
                    };
                })
                .filter(
                    (row) => Array.isArray(row?.panels) && row.panels.length > 0
                )
        );
    };

    const handleRemoveRow = (rowIndex) => {
        setEditRows((current) =>
            current.filter((_, index) => index !== rowIndex)
        );
    };

    const handleLiveUpdatePanel = async (rowIndex, panelIndex, nextPanel) => {
        if (!dashboard?.rows?.[rowIndex]?.panels) {
            return;
        }

        const rows = cloneDashboardRows(dashboard.rows);
        rows[rowIndex].panels[panelIndex] = nextPanel;

        try {
            await updateDashboard(dashboard.id, { rows });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to update dashboard panel.'
            );
        }
    };

    const handleDirectionChange = (rowIndex, direction) => {
        setEditRows((current) =>
            current.map((row, index) =>
                index === rowIndex
                    ? {
                          ...row,
                          direction:
                              direction === 'vertical'
                                  ? 'vertical'
                                  : 'horizontal'
                      }
                    : row
            )
        );
    };

    const handleSave = async () => {
        if (!dashboard) {
            return;
        }

        setIsSaving(true);
        try {
            await updateDashboard(dashboard.id, {
                name: editName.trim() || dashboard.name || 'Dashboard',
                rows: editRows
            });
            setIsEditing(false);
            toast.success('Dashboard saved.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to save dashboard.'
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!dashboard) {
            return;
        }

        const result = await confirm({
            title: 'Delete dashboard?',
            description:
                'This removes the dashboard definition from the stored navigation config.',
            destructive: true,
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        try {
            await deleteDashboard(dashboard.id);
            const fallback =
                dashboards.find((entry) => entry.id !== dashboard.id) || null;
            if (fallback) {
                navigate(`/dashboard/${fallback.id}`, { replace: true });
            } else {
                navigate('/feed', { replace: true });
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to delete dashboard.'
            );
        }
    };

    const handleCreateDashboard = async () => {
        try {
            const nextDashboard = await createDashboard('Dashboard');
            setEditingDashboardId(nextDashboard.id);
            navigate(`/dashboard/${nextDashboard.id}`);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Failed to create dashboard.'
            );
        }
    };

    if (!loaded && loadStatus !== 'error') {
        return (
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <LayoutDashboardIcon className="size-5" />
                            Dashboard
                        </CardTitle>
                        <CardDescription>
                            Loading dashboard configuration.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    if (!dashboard) {
        return (
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <Card>
                    <CardHeader className="gap-4">
                        <div className="flex flex-col gap-2">
                            <CardTitle className="flex items-center gap-2">
                                <LayoutDashboardIcon className="size-5" />
                                Dashboard
                            </CardTitle>
                            <CardDescription>
                                {dashboards.length
                                    ? 'That dashboard no longer exists in the stored config.'
                                    : 'No dashboard definitions are stored yet.'}
                            </CardDescription>
                        </div>
                        {detail ? (
                            <div className="text-muted-foreground text-sm">
                                {userFacingErrorMessage(
                                    detail,
                                    'Failed to load dashboard configuration.'
                                )}
                            </div>
                        ) : null}
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <Button type="button" onClick={handleCreateDashboard}>
                            <PlusIcon data-icon="inline-start" />
                            New Dashboard
                        </Button>
                        {dashboards.length ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    navigate(`/dashboard/${dashboards[0].id}`, {
                                        replace: true
                                    })
                                }
                            >
                                Open First Dashboard
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    navigate('/feed', { replace: true })
                                }
                            >
                                Back to Feed
                            </Button>
                        )}
                    </CardContent>
                </Card>
            </div>
        );
    }

    const rowCount = dashboard.rows?.length || 0;

    return (
        <div className="x-container flex h-full min-h-0 flex-col gap-3 py-3">
            {isEditing ? (
                <div className="bg-card flex items-center gap-2 rounded-md border px-3 py-2">
                    <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        placeholder="Dashboard name"
                        className="mx-2 h-7 max-w-52 text-sm"
                    />
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setIsEditing(false);
                                setShowAddRowOptions(false);
                                setEditName(dashboard.name || '');
                                setEditRows(cloneDashboardRows(dashboard.rows));
                            }}
                        >
                            <XIcon data-icon="inline-start" />
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={handleDelete}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            Delete
                        </Button>
                    </div>
                    <Button
                        type="button"
                        className="ml-auto"
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        <SaveIcon data-icon="inline-start" />
                        Save
                    </Button>
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {isEditing ? (
                    <>
                        {editRows.length ? (
                            editRows.map((row, rowIndex) => (
                                <DashboardEditorRow
                                    key={`edit-row-${rowIndex}`}
                                    row={row}
                                    rowIndex={rowIndex}
                                    onPanelChange={(panelIndex, nextPanel) =>
                                        handleUpdatePanel(
                                            rowIndex,
                                            panelIndex,
                                            nextPanel
                                        )
                                    }
                                    onPanelRemove={(panelIndex) =>
                                        handleRemovePanel(rowIndex, panelIndex)
                                    }
                                    onRowRemove={() =>
                                        handleRemoveRow(rowIndex)
                                    }
                                    onDirectionChange={(direction) =>
                                        handleDirectionChange(
                                            rowIndex,
                                            direction
                                        )
                                    }
                                />
                            ))
                        ) : (
                            <div className="text-muted-foreground flex min-h-[180px] items-center justify-center rounded-md border border-dashed text-sm">
                                Add a row to start building this dashboard.
                            </div>
                        )}

                        {showAddRowOptions ? (
                            <div className="border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 mt-auto flex min-h-[80px] flex-1 items-start justify-center rounded-md border-2 border-dashed p-4 transition-colors">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-muted-foreground text-xs">
                                        Add Row:
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-10 w-16 border-2 border-dashed"
                                        title="Add Full Row"
                                        aria-label="Add full row"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleAddRow(1);
                                        }}
                                    >
                                        <div className="bg-muted-foreground/20 h-6 w-12 rounded" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-10 w-16 gap-1 border-2 border-dashed"
                                        title="Add Split Row"
                                        aria-label="Add split row"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleAddRow(2);
                                        }}
                                    >
                                        <div className="bg-muted-foreground/20 h-6 w-5 rounded" />
                                        <div className="bg-muted-foreground/20 h-6 w-5 rounded" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-10 w-16 gap-1 border-2 border-dashed"
                                        title="Add Vertical Row"
                                        aria-label="Add vertical row"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleAddRow(2, 'vertical');
                                        }}
                                    >
                                        <div className="flex flex-col gap-0.5">
                                            <div className="bg-muted-foreground/20 h-2.5 w-10 rounded" />
                                            <div className="bg-muted-foreground/20 h-2.5 w-10 rounded" />
                                        </div>
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button
                                type="button"
                                variant="ghost"
                                className="border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 mt-auto flex min-h-[80px] flex-1 items-center justify-center rounded-md border-2 border-dashed transition-colors"
                                aria-label="Show add row options"
                                onClick={() => setShowAddRowOptions(true)}
                            >
                                <PlusIcon className="size-6 opacity-50" />
                            </Button>
                        )}
                    </>
                ) : rowCount ? (
                    <ResizablePanelGroup
                        id={`dashboard-${id}`}
                        orientation="vertical"
                        className="min-h-0 flex-1"
                        defaultLayout={dashboardLayout.defaultLayout}
                        onLayoutChanged={dashboardLayout.onLayoutChanged}
                    >
                        {dashboard.rows.map((row, rowIndex) => {
                            const rowKey = getDashboardRowKey(row);
                            return (
                                <Fragment key={`row-${rowKey}`}>
                                    <ResizablePanel
                                        id={`dashboard-${id}-row-panel-${rowKey}`}
                                        defaultSize={`${100 / rowCount}%`}
                                        minSize="10%"
                                    >
                                        <DashboardReadRow
                                            row={row}
                                            dashboardId={id}
                                            onPanelChange={(
                                                panelIndex,
                                                nextPanel
                                            ) =>
                                                void handleLiveUpdatePanel(
                                                    rowIndex,
                                                    panelIndex,
                                                    nextPanel
                                                )
                                            }
                                        />
                                    </ResizablePanel>
                                    {rowIndex < rowCount - 1 ? (
                                        <ResizableHandle />
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </ResizablePanelGroup>
                ) : (
                    <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-md border border-dashed">
                        <div className="flex flex-col items-center gap-3">
                            <p>This dashboard is empty</p>
                            <Button
                                type="button"
                                onClick={() => setIsEditing(true)}
                            >
                                Start Editing
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
