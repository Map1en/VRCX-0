import { Fragment, useEffect, useMemo, useState } from 'react';
import {
    LayoutDashboardIcon,
    PlusIcon,
    SaveIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { DashboardPanelPreview } from '@/components/dashboard/DashboardPanelPreview.jsx';
import {
    createDashboardPanelValue,
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS,
    DASHBOARD_SELECTABLE_PAGE_DEFINITIONS,
    DASHBOARD_WIDGET_DEFINITIONS,
    getDashboardPanelDefinition,
    resolveDashboardPanelKey
} from '@/components/dashboard/dashboardRegistry.js';
import { cn } from '@/lib/utils.js';
import { FEED_FILTER_TYPES, GAME_LOG_FILTER_TYPES } from '@/repositories/index.js';
import { generateDashboardRowId } from '@/repositories/dashboardRepository.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/shadcn/card.jsx';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable.jsx';
import { Switch } from '@/ui/shadcn/switch.jsx';

function cloneRows(rows) {
    return JSON.parse(JSON.stringify(Array.isArray(rows) ? rows : []));
}

function getDashboardRowKey(row) {
    if (typeof row?.id === 'string' && row.id.trim()) {
        return row.id.trim();
    }

    const source = JSON.stringify({
        direction: row?.direction === 'vertical' ? 'vertical' : 'horizontal',
        panels: Array.isArray(row?.panels)
            ? row.panels.map((panel) => (typeof panel === 'string' ? panel : panel?.key || ''))
            : []
    });
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    }
    return `legacy-${hash.toString(36)}`;
}

function createPanelSelectOptions(currentPanelKey) {
    const options = [
        ...DASHBOARD_WIDGET_DEFINITIONS.map((definition) => ({
            value: definition.key,
            label: `Widget · ${definition.label}`
        })),
        ...DASHBOARD_SELECTABLE_PAGE_DEFINITIONS.map((definition) => ({
            value: definition.key,
            label: `Page · ${definition.label}`
        }))
    ];

    if (
        currentPanelKey &&
        currentPanelKey !== '__none__' &&
        !options.some((option) => option.value === currentPanelKey)
    ) {
        options.unshift({
            value: currentPanelKey,
            label: `Existing · ${getDashboardPanelDefinition(currentPanelKey)?.label || currentPanelKey}`
        });
    }

    return options;
}

function getPanelConfig(panel) {
    if (!panel || typeof panel !== 'object') {
        return {};
    }

    return panel.config && typeof panel.config === 'object' ? panel.config : {};
}

function cloneConfig(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    return JSON.parse(JSON.stringify(value));
}

function createWidgetPanelValue(panelKey, config) {
    return {
        key: panelKey,
        config: cloneConfig(config)
    };
}

function getFilterList(config) {
    return Array.isArray(config?.filters) ? config.filters : [];
}

function isFilterActive(config, filterType) {
    const filters = getFilterList(config);
    return filters.length === 0 || filters.includes(filterType);
}

function getNextFilterConfig(config, filterType, filterTypes) {
    const currentFilters = getFilterList(config);
    let filters;

    if (currentFilters.length === 0) {
        filters = filterTypes.filter((entry) => entry !== filterType);
    } else if (currentFilters.includes(filterType)) {
        filters = currentFilters.filter((entry) => entry !== filterType);
        if (filters.length === 0) {
            filters = [];
        }
    } else {
        filters = [...currentFilters, filterType];
        if (filters.length === filterTypes.length) {
            filters = [];
        }
    }

    return {
        ...config,
        filters
    };
}

const DASHBOARD_INSTANCE_WIDGET_COLUMN_KEYS = new Set(
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map((column) => column.key)
);

function getInstanceWidgetColumns(config) {
    const source = Array.isArray(config?.columns)
        ? config.columns
        : DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS;
    const columns = source.filter(
        (column, index, values) =>
            typeof column === 'string' && column && values.indexOf(column) === index
    );

    if (!columns.includes('displayName')) {
        columns.unshift('displayName');
    }

    return columns.length ? columns : [...DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS];
}

function getKnownInstanceWidgetColumns(config) {
    const columns = getInstanceWidgetColumns(config).filter((column) =>
        DASHBOARD_INSTANCE_WIDGET_COLUMN_KEYS.has(column)
    );

    if (!columns.includes('displayName')) {
        columns.unshift('displayName');
    }

    return columns.length ? columns : [...DASHBOARD_INSTANCE_WIDGET_DEFAULT_COLUMNS];
}

function getNextInstanceColumnConfig(config, columnKey) {
    if (columnKey === 'displayName') {
        return config;
    }

    const sourceColumns = getInstanceWidgetColumns(config);
    const unknownColumns = sourceColumns.filter(
        (column) => !DASHBOARD_INSTANCE_WIDGET_COLUMN_KEYS.has(column)
    );
    const knownColumns = getKnownInstanceWidgetColumns(config);
    const nextKnownColumns = knownColumns.includes(columnKey)
        ? knownColumns.filter((column) => column !== columnKey)
        : [...knownColumns, columnKey];

    if (!nextKnownColumns.includes('displayName')) {
        nextKnownColumns.unshift('displayName');
    }

    return {
        ...config,
        columns: [...nextKnownColumns, ...unknownColumns]
    };
}

function DashboardFilterConfig({ title, filterTypes, config, onConfigChange }) {
    const filters = getFilterList(config);

    return (
        <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {title}
            </div>
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant={filters.length === 0 ? 'default' : 'outline'}
                    onClick={() => onConfigChange({ ...config, filters: [] })}>
                    All
                </Button>
                {filterTypes.map((filterType) => (
                    <Button
                        key={filterType}
                        type="button"
                        size="sm"
                        variant={isFilterActive(config, filterType) ? 'default' : 'outline'}
                        onClick={() =>
                            onConfigChange(getNextFilterConfig(config, filterType, filterTypes))
                        }>
                        {filterType}
                    </Button>
                ))}
            </div>
        </div>
    );
}

function DashboardSwitchConfig({ label, description, checked, onCheckedChange }) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2">
            <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {description ? (
                    <div className="text-xs text-muted-foreground">{description}</div>
                ) : null}
            </div>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}

function DashboardInstanceColumnConfig({ config, onConfigChange }) {
    const activeColumns = getKnownInstanceWidgetColumns(config);

    return (
        <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Visible columns
            </div>
            <div className="flex flex-wrap gap-2">
                {DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS.map((column) => (
                    <Button
                        key={column.key}
                        type="button"
                        size="sm"
                        variant={activeColumns.includes(column.key) ? 'default' : 'outline'}
                        disabled={column.required}
                        onClick={() =>
                            onConfigChange(getNextInstanceColumnConfig(config, column.key))
                        }>
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
            <div className="space-y-3">
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
                        onConfigChange({ ...config, showType: Boolean(checked) })
                    }
                />
            </div>
        );
    }

    if (panelKey === 'widget:game-log') {
        return (
            <div className="space-y-3">
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
                        onConfigChange({ ...config, showDetail: Boolean(checked) })
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

function DashboardPanelSelectorDialog({ open, currentPanelKey, onOpenChange, onSelect }) {
    const options = useMemo(() => createPanelSelectOptions(currentPanelKey), [currentPanelKey]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Select panel</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto">
                    <div className="grid gap-2 sm:grid-cols-2">
                        <button
                            type="button"
                            className="rounded-md border border-dashed p-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/40"
                            onClick={() => onSelect('__none__')}>
                            Not configured
                        </button>
                        {options.map((option) => {
                            const definition = getDashboardPanelDefinition(option.value);
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    className={cn(
                                        'rounded-md border p-3 text-left transition-colors hover:bg-muted/40',
                                        option.value === currentPanelKey && 'border-primary bg-primary/5'
                                    )}
                                    onClick={() => onSelect(option.value)}>
                                    <div className="truncate text-sm font-medium">
                                        {definition?.label || option.label}
                                    </div>
                                    <div className="line-clamp-2 text-xs text-muted-foreground">
                                        {definition?.description || option.value}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function DashboardEditorPanel({ panel, onChange, onRemove, showRemove = true }) {
    const [selectorOpen, setSelectorOpen] = useState(false);
    const panelKey = resolveDashboardPanelKey(panel) ?? '__none__';
    const panelDefinition = getDashboardPanelDefinition(panelKey);
    const panelConfig = getPanelConfig(panel);
    const canConfigure = Boolean(panelDefinition?.category === 'widget');

    function updatePanelConfig(nextConfig) {
        if (!canConfigure || panelKey === '__none__') {
            return;
        }
        onChange(createWidgetPanelValue(panelKey, nextConfig));
    }

    return (
        <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
            {showRemove ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-1 z-20"
                    onClick={onRemove}>
                    <XIcon className="size-4" />
                </Button>
            ) : null}
            <div className="flex w-full min-h-0 flex-col items-center justify-center gap-3 p-3">
                {panelKey !== '__none__' ? (
                    <div className="w-full space-y-3">
                        <div className="flex items-center justify-center gap-2 text-base text-muted-foreground">
                            <span>{panelDefinition?.label || panelKey}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => onChange(null)}>
                                <Trash2Icon className="size-3.5" />
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
                        <span className="text-base text-muted-foreground">Panel not selected</span>
                        <Button type="button" variant="outline" onClick={() => setSelectorOpen(true)}>
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
                    onClick={() => setSelectorOpen(true)}>
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
    const panelEditClass = panels.length === 1
        ? 'w-full'
        : direction === 'vertical'
            ? 'h-1/2'
            : 'w-1/2';

    return (
        <div className="relative h-full min-h-[180px] space-y-2 rounded-md border border-dashed p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Row {rowIndex + 1}
                </div>
                <div className="flex items-center gap-2">
                    {panels.length === 2 ? (
                        <Select value={direction} onValueChange={onDirectionChange}>
                            <SelectTrigger size="sm" className="h-7 w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="horizontal">Horizontal</SelectItem>
                                <SelectItem value="vertical">Vertical</SelectItem>
                            </SelectContent>
                        </Select>
                    ) : null}
                    <Button type="button" variant="ghost" size="icon-sm" onClick={onRowRemove}>
                        <Trash2Icon className="size-4" />
                    </Button>
                </div>
            </div>
            <div className={cn('flex min-h-[180px] gap-2', direction === 'vertical' ? 'flex-col' : 'flex-row')}>
                {panels.map((panel, panelIndex) => (
                    <div key={`${rowIndex}-${panelIndex}`} className={panelEditClass}>
                        <DashboardEditorPanel
                            panel={panel}
                            onChange={(nextPanel) => onPanelChange(panelIndex, nextPanel)}
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

    if (panels.length === 2) {
        return (
            <div className="relative h-full min-h-[180px]">
                <ResizablePanelGroup
                    direction={direction}
                    autoSaveId={`dashboard-${dashboardId}-row-${rowKey}`}
                    className="h-full min-h-[180px]">
                    <ResizablePanel
                        id={`dashboard-${dashboardId}-row-${rowKey}-panel-0`}
                        order={1}
                        defaultSize={50}
                        minSize={20}>
                        <div className="h-full min-h-[180px] min-w-0">
                            <DashboardPanelPreview
                                panel={panels[0]}
                                onPanelChange={(nextPanel) => onPanelChange?.(0, nextPanel)}
                            />
                        </div>
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel
                        id={`dashboard-${dashboardId}-row-${rowKey}-panel-1`}
                        order={2}
                        defaultSize={50}
                        minSize={20}>
                        <div className="h-full min-h-[180px] min-w-0">
                            <DashboardPanelPreview
                                panel={panels[1]}
                                onPanelChange={(nextPanel) => onPanelChange?.(1, nextPanel)}
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
    const consumeEditingDashboardId = useDashboardStore((state) => state.consumeEditingDashboardId);
    const setEditingDashboardId = useDashboardStore((state) => state.setEditingDashboardId);
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
        setEditRows(cloneRows(dashboard.rows));
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

                const panels = Array.isArray(row?.panels) ? row.panels.slice(0, 2) : [];
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

                    const panels = Array.isArray(row?.panels) ? row.panels.slice(0, 2) : [];
                    panels.splice(panelIndex, 1);
                    return {
                        ...row,
                        panels
                    };
                })
                .filter((row) => Array.isArray(row?.panels) && row.panels.length > 0)
        );
    };

    const handleRemoveRow = (rowIndex) => {
        setEditRows((current) => current.filter((_, index) => index !== rowIndex));
    };

    const handleLiveUpdatePanel = async (rowIndex, panelIndex, nextPanel) => {
        if (!dashboard?.rows?.[rowIndex]?.panels) {
            return;
        }

        const rows = cloneRows(dashboard.rows);
        rows[rowIndex].panels[panelIndex] = nextPanel;

        try {
            await updateDashboard(dashboard.id, { rows });
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : 'Failed to update dashboard panel.'
            );
        }
    };

    const handleDirectionChange = (rowIndex, direction) => {
        setEditRows((current) =>
            current.map((row, index) =>
                index === rowIndex
                    ? {
                          ...row,
                          direction: direction === 'vertical' ? 'vertical' : 'horizontal'
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
                error instanceof Error ? error.message : 'Failed to save dashboard.'
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
            const fallback = dashboards.find((entry) => entry.id !== dashboard.id) || null;
            if (fallback) {
                navigate(`/dashboard/${fallback.id}`, { replace: true });
            } else {
                navigate('/feed', { replace: true });
            }
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : 'Failed to delete dashboard.'
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
                error instanceof Error ? error.message : 'Failed to create dashboard.'
            );
        }
    };

    if (!loaded && loadStatus !== 'error') {
        return (
            <div className="space-y-6 p-4 md:p-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <LayoutDashboardIcon className="size-5" />
                            Dashboard
                        </CardTitle>
                        <CardDescription>Loading dashboard configuration.</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    if (!dashboard) {
        return (
            <div className="space-y-6 p-4 md:p-6">
                <Card>
                    <CardHeader className="gap-4">
                        <div className="space-y-2">
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
                        {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <Button type="button" onClick={handleCreateDashboard}>
                            <PlusIcon className="size-4" />
                            New Dashboard
                        </Button>
                        {dashboards.length ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => navigate(`/dashboard/${dashboards[0].id}`, { replace: true })}>
                                Open First Dashboard
                            </Button>
                        ) : (
                            <Button type="button" variant="outline" onClick={() => navigate('/feed', { replace: true })}>
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
                <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                    <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        placeholder="Dashboard name"
                        className="mx-2 h-7 max-w-[200px] text-sm"
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
                                setEditRows(cloneRows(dashboard.rows));
                            }}>
                            <XIcon className="size-4" />
                            Cancel
                        </Button>
                        <Button type="button" variant="destructive" size="sm" onClick={handleDelete}>
                            <Trash2Icon className="size-4" />
                            Delete
                        </Button>
                    </div>
                    <Button type="button" className="ml-auto" size="sm" onClick={handleSave} disabled={isSaving}>
                        <SaveIcon className="size-4" />
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
                                        handleUpdatePanel(rowIndex, panelIndex, nextPanel)
                                    }
                                    onPanelRemove={(panelIndex) =>
                                        handleRemovePanel(rowIndex, panelIndex)
                                    }
                                    onRowRemove={() => handleRemoveRow(rowIndex)}
                                    onDirectionChange={(direction) =>
                                        handleDirectionChange(rowIndex, direction)
                                    }
                                />
                            ))
                        ) : (
                            <div className="flex min-h-[180px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                                Add a row to start building this dashboard.
                            </div>
                        )}

                        <div
                            className={`mt-auto flex min-h-[80px] flex-1 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 ${
                                showAddRowOptions ? 'items-start p-4' : 'cursor-pointer'
                            }`}
                            onClick={() => setShowAddRowOptions((value) => !value)}>
                            {showAddRowOptions ? (
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-xs text-muted-foreground">Add Row:</span>
                                    <button
                                        type="button"
                                        className="flex h-10 w-16 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/30 transition-colors hover:border-primary/50 hover:bg-primary/5"
                                        title="Add Full Row"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleAddRow(1);
                                        }}>
                                        <div className="h-6 w-12 rounded bg-muted-foreground/20" />
                                    </button>
                                    <button
                                        type="button"
                                        className="flex h-10 w-16 items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/30 transition-colors hover:border-primary/50 hover:bg-primary/5"
                                        title="Add Split Row"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleAddRow(2);
                                        }}>
                                        <div className="h-6 w-5 rounded bg-muted-foreground/20" />
                                        <div className="h-6 w-5 rounded bg-muted-foreground/20" />
                                    </button>
                                    <button
                                        type="button"
                                        className="flex h-10 w-16 items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/30 transition-colors hover:border-primary/50 hover:bg-primary/5"
                                        title="Add Vertical Row"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleAddRow(2, 'vertical');
                                        }}>
                                        <div className="flex flex-col gap-0.5">
                                            <div className="h-2.5 w-10 rounded bg-muted-foreground/20" />
                                            <div className="h-2.5 w-10 rounded bg-muted-foreground/20" />
                                        </div>
                                    </button>
                                </div>
                            ) : (
                                <PlusIcon className="size-6 opacity-50" />
                            )}
                        </div>
                    </>
                ) : rowCount ? (
                    <ResizablePanelGroup
                        direction="vertical"
                        autoSaveId={`dashboard-${id}`}
                        className="min-h-0 flex-1">
                        {dashboard.rows.map((row, rowIndex) => {
                            const rowKey = getDashboardRowKey(row);
                            return (
                                <Fragment key={`row-${rowKey}`}>
                                    <ResizablePanel
                                        id={`dashboard-${id}-row-panel-${rowKey}`}
                                        order={rowIndex + 1}
                                        defaultSize={100 / rowCount}
                                        minSize={10}>
                                        <DashboardReadRow
                                            row={row}
                                            dashboardId={id}
                                            onPanelChange={(panelIndex, nextPanel) =>
                                                void handleLiveUpdatePanel(rowIndex, panelIndex, nextPanel)
                                            }
                                        />
                                    </ResizablePanel>
                                    {rowIndex < rowCount - 1 ? <ResizableHandle /> : null}
                                </Fragment>
                            );
                        })}
                    </ResizablePanelGroup>
                ) : (
                    <div className="flex flex-1 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                        <div className="flex flex-col items-center gap-3">
                            <p>This dashboard is empty</p>
                            <Button type="button" onClick={() => setIsEditing(true)}>
                                Start Editing
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
