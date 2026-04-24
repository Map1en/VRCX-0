import { Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";

import { useTranslation } from 'react-i18next';
import { DashboardPanelPreview } from "@/components/dashboard/DashboardPanelPreview.jsx";
import {
    createDashboardPanelValue,
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    getDashboardInstanceWidgetColumnLabel,
    getDashboardPanelDefinition,
    getDashboardPanelDescription,
    getDashboardPanelLabel,
    resolveDashboardPanelKey
} from "@/components/dashboard/dashboardRegistry.js";
import { cn } from "@/lib/utils.js";
import { FEED_FILTER_TYPES, GAME_LOG_FILTER_TYPES } from "@/repositories/index.js";
import { Button } from "@/ui/shadcn/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "@/ui/shadcn/dialog";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from "@/ui/shadcn/resizable";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/ui/shadcn/select";
import { Switch } from "@/ui/shadcn/switch";

import {
    createDashboardPanelSelectOptions,
    createDashboardWidgetPanelValue,
    getDashboardFilterList,
    getDashboardPanelConfig,
    getDashboardRowKey,
    getKnownDashboardInstanceWidgetColumns,
    getNextDashboardFilterConfig,
    getNextDashboardInstanceColumnConfig,
    isDashboardFilterActive
} from "../dashboardConfig.js";

export function DashboardFilterConfig({ title, filterTypes, config, onConfigChange }) {
    const { t } = useTranslation();

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
                    {t('view.dashboard.generated.all')}
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

export function DashboardSwitchConfig({
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

export function DashboardInstanceColumnConfig({ config, onConfigChange }) {
    const { t } = useTranslation();

    const activeColumns = getKnownDashboardInstanceWidgetColumns(config);

    return (
        <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('view.dashboard.generated.visible_columns')}
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
                        {getDashboardInstanceWidgetColumnLabel(column, t)}
                    </Button>
                ))}
            </div>
        </div>
    );
}

export function DashboardWidgetConfigEditor({ panelKey, config, onConfigChange }) {
    const { t } = useTranslation();

    if (panelKey === 'widget:feed') {
        return (
            <div className="flex flex-col gap-3">
                <DashboardFilterConfig
                    title={t('view.dashboard.generated.feed_filters')}
                    filterTypes={FEED_FILTER_TYPES}
                    config={config}
                    onConfigChange={onConfigChange}
                />
                <DashboardSwitchConfig
                    label={t('view.dashboard.generated.show_type_column')}
                    description={t('view.dashboard.generated.matches_the_stored_feed_widget_config')}
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
                    title={t('view.dashboard.generated.game_log_filters')}
                    filterTypes={GAME_LOG_FILTER_TYPES}
                    config={config}
                    onConfigChange={onConfigChange}
                />
                <DashboardSwitchConfig
                    label={t('view.dashboard.generated.show_detail')}
                    description={t('view.dashboard.generated.expands_the_compact_game_log_description')}
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

export function DashboardPanelSelectorDialog({
    open,
    currentPanelKey,
    onOpenChange,
    onSelect
}) {
    const { t } = useTranslation();

    const options = createDashboardPanelSelectOptions(currentPanelKey, t);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('view.dashboard.generated.select_panel')}</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto">
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="text-muted-foreground h-auto justify-start border-dashed p-3 text-left font-normal whitespace-normal"
                            onClick={() => onSelect('__none__')}
                        >
                            {t('view.dashboard.generated.not_configured')}
                        </Button>
                        {options.map((option) => {
                            const definition = getDashboardPanelDefinition(
                                option.value
                            );
                            const selected = option.value === currentPanelKey;
                            const label = definition
                                ? getDashboardPanelLabel(definition, t)
                                : option.label;
                            const description = definition
                                ? getDashboardPanelDescription(definition, t)
                                : option.value;
                            return (
                                <Button
                                    key={option.value}
                                    type="button"
                                    variant={selected ? 'secondary' : 'outline'}
                                    className="h-auto flex-col items-start justify-start p-3 text-left font-normal whitespace-normal"
                                    onClick={() => onSelect(option.value)}
                                >
                                    <div className="truncate text-sm font-medium">
                                        {label}
                                    </div>
                                    <div className="text-muted-foreground line-clamp-2 text-xs">
                                        {description}
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

export function DashboardEditorPanel({
    panel,
    onChange,
    onRemove,
    showRemove = true
}) {
    const { t } = useTranslation();

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
                    aria-label={"Remove panel"}
                    onClick={onRemove}
                >
                    <XIcon data-icon="inline-start" />
                </Button>
            ) : null}
            <div className="flex min-h-0 w-full flex-col items-center justify-center gap-3 p-3">
                {panelKey !== '__none__' ? (
                    <div className="flex w-full flex-col gap-3">
                        <div className="text-muted-foreground flex items-center justify-center gap-2 text-base">
                            <span>
                                {panelDefinition
                                    ? getDashboardPanelLabel(panelDefinition, t)
                                    : panelKey}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={"Clear panel"}
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
                            {t('view.dashboard.generated.panel_not_selected')}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSelectorOpen(true)}
                        >
                            {t('common.actions.select')}
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
                    {t('common.actions.select')}
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

export function DashboardEditorRow({
    row,
    rowIndex,
    onPanelChange,
    onPanelRemove,
    onRowRemove,
    onDirectionChange
}) {
    const { t } = useTranslation();

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
                    {t('view.dashboard.generated.row')} {rowIndex + 1}
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
                                        {t('view.dashboard.generated.horizontal')}
                                    </SelectItem>
                                    <SelectItem value="vertical">
                                        {t('view.dashboard.generated.vertical')}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={"Remove row"}
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

export function DashboardReadRow({ row, dashboardId, onPanelChange }) {
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
