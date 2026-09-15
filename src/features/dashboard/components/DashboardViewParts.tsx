import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefaultLayout } from 'react-resizable-panels';
import { useShallow } from 'zustand/react/shallow';

import type {
    DashboardPanel,
    DashboardRow
} from '@/repositories/dashboardRepository';
import { FEED_FILTER_TYPES } from '@/repositories/feedRepository';
import { GAME_LOG_FILTER_TYPES } from '@/repositories/gameLogRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useNotificationStore } from '@/state/notificationStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { ResizablePanel, ResizablePanelGroup } from '@/ui/shadcn/resizable';
import { Switch } from '@/ui/shadcn/switch';

import {
    createDashboardPanelSelectOptions,
    type DashboardConfig,
    getDashboardFilterList,
    getDashboardRowKey,
    getKnownDashboardInstanceWidgetColumns,
    getNextDashboardFilterConfig,
    getNextDashboardInstanceColumnConfig,
    isDashboardFilterActive
} from '../dashboardConfig';
import {
    createDashboardPanelPreviewProps,
    type DashboardPageMetrics
} from '../dashboardPanelPreviewModel';
import {
    DASHBOARD_INSTANCE_WIDGET_COLUMN_DEFINITIONS,
    getDashboardInstanceWidgetColumnLabel,
    getDashboardPanelDefinition,
    getDashboardPanelDescription,
    getDashboardPanelLabel
} from '../dashboardRegistry';
import {
    DashboardPanelPreview,
    type DashboardPanelFrameMode
} from './DashboardPanelPreview';
import { DashboardResizeHandle } from './DashboardResizeHandle';

function DashboardFilterConfig({
    title,
    filterTypes,
    config,
    onConfigChange
}: {
    title: string;
    filterTypes: readonly string[];
    config: DashboardConfig;
    onConfigChange: (config: DashboardConfig) => void;
}) {
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
                    {t('view.dashboard.label.all')}
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
}: {
    label: ReactNode;
    description?: ReactNode;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
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

function DashboardInstanceColumnConfig({
    config,
    onConfigChange
}: {
    config: DashboardConfig;
    onConfigChange: (config: DashboardConfig) => void;
}) {
    const { t } = useTranslation();

    const activeColumns = getKnownDashboardInstanceWidgetColumns(config);

    return (
        <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('view.dashboard.label.visible_columns')}
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

export function DashboardWidgetConfigEditor({
    panelKey,
    config,
    onConfigChange
}: {
    panelKey: string;
    config: DashboardConfig;
    onConfigChange: (config: DashboardConfig) => void;
}) {
    const { t } = useTranslation();

    if (panelKey === 'widget:feed') {
        return (
            <div className="flex flex-col gap-3">
                <DashboardFilterConfig
                    title={t('view.dashboard.label.feed_filters')}
                    filterTypes={FEED_FILTER_TYPES}
                    config={config}
                    onConfigChange={onConfigChange}
                />
                <DashboardSwitchConfig
                    label={t('view.dashboard.action.show_type_column')}
                    description={t(
                        'view.dashboard.description.matches_the_stored_feed_widget_config'
                    )}
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
                    title={t('view.dashboard.label.game_log_filters')}
                    filterTypes={GAME_LOG_FILTER_TYPES}
                    config={config}
                    onConfigChange={onConfigChange}
                />
                <DashboardSwitchConfig
                    label={t('view.dashboard.action.show_detail')}
                    description={t(
                        'view.dashboard.description.expands_the_compact_game_log_description'
                    )}
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
}: {
    open: boolean;
    currentPanelKey: string;
    onOpenChange: (open: boolean) => void;
    onSelect: (value: string) => void;
}) {
    const { t } = useTranslation();

    const options = createDashboardPanelSelectOptions(currentPanelKey, t);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('view.dashboard.action.select_panel')}
                    </DialogTitle>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto">
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="text-muted-foreground h-auto justify-start border-dashed p-3 text-left font-normal whitespace-normal"
                            onClick={() => onSelect('__none__')}
                        >
                            {t('view.dashboard.label.not_configured')}
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

function useDashboardPagePreviewMetrics(): DashboardPageMetrics {
    const { friendCount, onlineCount } = useFriendRosterStore(
        useShallow((state) => ({
            friendCount: state.orderedFriendIds.length,
            onlineCount: state.onlineIds.length
        }))
    );
    const { favoriteFriendCount, favoriteWorldCount, favoriteAvatarCount } =
        useFavoriteStore(
            useShallow((state) => ({
                favoriteFriendCount: state.favoriteFriendIds.length,
                favoriteWorldCount: state.favoriteWorldIds.length,
                favoriteAvatarCount: state.favoriteAvatarIds.length
            }))
        );
    const notificationCount = useNotificationStore(
        (state) => state.items.length
    );

    return {
        friendCount,
        onlineCount,
        favoriteFriendCount,
        favoriteWorldCount,
        favoriteAvatarCount,
        notificationCount
    };
}

export function DashboardPanelPreviewForPanel({
    panel,
    onPanelChange,
    frameMode = 'card'
}: {
    panel: DashboardPanel | null;
    onPanelChange?: (panel: DashboardPanel | null) => void;
    frameMode?: DashboardPanelFrameMode;
}) {
    const pageMetrics = useDashboardPagePreviewMetrics();
    const previewProps = createDashboardPanelPreviewProps({
        panel,
        pageMetrics,
        onPanelChange
    });

    return <DashboardPanelPreview {...previewProps} frameMode={frameMode} />;
}

export function DashboardReadRow({
    row,
    dashboardId,
    onPanelChange
}: {
    row: DashboardRow;
    dashboardId: string;
    onPanelChange?: (panelIndex: number, panel: DashboardPanel | null) => void;
}) {
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
                            <DashboardPanelPreviewForPanel
                                panel={panels[0]}
                                frameMode="docked"
                                onPanelChange={(nextPanel) =>
                                    onPanelChange?.(0, nextPanel)
                                }
                            />
                        </div>
                    </ResizablePanel>
                    <DashboardResizeHandle />
                    <ResizablePanel
                        id={secondPanelId}
                        defaultSize="50%"
                        minSize="20%"
                    >
                        <div className="h-full min-h-[180px] min-w-0">
                            <DashboardPanelPreviewForPanel
                                panel={panels[1]}
                                frameMode="docked"
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
            <DashboardPanelPreviewForPanel
                panel={panels[0]}
                frameMode="docked"
                onPanelChange={(nextPanel) => onPanelChange?.(0, nextPanel)}
            />
        </div>
    );
}
