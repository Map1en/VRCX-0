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

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { generateDashboardRowId } from '@/repositories/dashboardRepository.js';
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
import { Input } from '@/ui/shadcn/input';

import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup
} from '@/ui/shadcn/resizable';
import {
    cloneDashboardRows,
    getDashboardRowKey
} from './dashboardConfig.js';
import {
    DashboardEditorRow,
    DashboardReadRow
} from './components/DashboardViewParts.jsx';

function DashboardAddRowControl({ onAddRow }) {
    const { t } = useTranslation();
    const [showOptions, setShowOptions] = useState(false);

    function addRow(panelCount, direction) {
        onAddRow(panelCount, direction);
        setShowOptions(false);
    }

    if (!showOptions) {
        return (
            <Button
                type="button"
                variant="ghost"
                className="border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 mt-auto flex min-h-[80px] flex-1 items-center justify-center rounded-md border-2 border-dashed transition-colors"
                aria-label={"Show add row options"}
                onClick={() => setShowOptions(true)}
            >
                <PlusIcon data-icon="icon" className="opacity-50" />
            </Button>
        );
    }

    return (
        <div className="border-muted-foreground/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 mt-auto flex min-h-[80px] flex-1 items-start justify-center rounded-md border-2 border-dashed p-4 transition-colors">
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground text-xs">
                    {t('view.dashboard.generated.add_row')}
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-16 border-2 border-dashed"
                    title={t('dashboard.actions.add_full_row')}
                    aria-label={"Add full row"}
                    onClick={(event) => {
                        event.stopPropagation();
                        addRow(1);
                    }}
                >
                    <div className="bg-muted-foreground/20 h-6 w-12 rounded" />
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-16 gap-1 border-2 border-dashed"
                    title={t('dashboard.actions.add_split_row')}
                    aria-label={"Add split row"}
                    onClick={(event) => {
                        event.stopPropagation();
                        addRow(2);
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
                    title={t('dashboard.actions.add_vertical_row')}
                    aria-label={"Add vertical row"}
                    onClick={(event) => {
                        event.stopPropagation();
                        addRow(2, 'vertical');
                    }}
                >
                    <div className="flex flex-col gap-0.5">
                        <div className="bg-muted-foreground/20 h-2.5 w-10 rounded" />
                        <div className="bg-muted-foreground/20 h-2.5 w-10 rounded" />
                    </div>
                </Button>
            </div>
        </div>
    );
}

function useDashboardEditorController({ dashboard, updateDashboard, t }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editRows, setEditRows] = useState([]);
    const [isSaving, setIsSaving] = useState(false);

    function resetEditDraft() {
        setEditName(dashboard?.name || '');
        setEditRows(cloneDashboardRows(dashboard?.rows));
    }

    useEffect(() => {
        if (!dashboard) {
            setIsEditing(false);
            setEditName('');
            setEditRows([]);
            return;
        }

        resetEditDraft();
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
            toast.success(t('view.dashboard.generated.dashboard_saved'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.dashboard.generated_toast.failed_to_save_dashboard')
            );
        } finally {
            setIsSaving(false);
        }
    };

    function cancelEditing() {
        setIsEditing(false);
        resetEditDraft();
    }

    return {
        cancelEditing,
        editName,
        editRows,
        handleAddRow,
        handleDirectionChange,
        handleRemovePanel,
        handleRemoveRow,
        handleSave,
        handleUpdatePanel,
        isEditing,
        isSaving,
        setEditName,
        setIsEditing
    };
}

export function DashboardPage() {
    const { t } = useTranslation();

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

    const dashboard = dashboards.find((entry) => entry.id === id) || null;
    const {
        cancelEditing,
        editName,
        editRows,
        handleAddRow,
        handleDirectionChange,
        handleRemovePanel,
        handleRemoveRow,
        handleSave,
        handleUpdatePanel,
        isEditing,
        isSaving,
        setEditName,
        setIsEditing
    } = useDashboardEditorController({
        dashboard,
        updateDashboard,
        t
    });
    const dashboardRowPanelIds = useMemo(
        () =>
            (Array.isArray(dashboard?.rows) ? dashboard.rows : []).map(
                (row) => `dashboard-${id}-row-panel-${getDashboardRowKey(row)}`
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
    }, [consumeEditingDashboardId, id, loaded]);

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
                    : t('view.dashboard.generated_toast.failed_to_update_dashboard_panel')
            );
        }
    };

    const handleDelete = async () => {
        if (!dashboard) {
            return;
        }

        const result = await confirm({
            title: t('view.dashboard.generated_modal.delete_dashboard'),
            description:
                t('view.dashboard.generated_modal.this_removes_the_dashboard_definition_from_the_s'),
            destructive: true,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel')
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
                    : t('view.dashboard.generated_toast.failed_to_delete_dashboard')
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
                    : t('view.dashboard.generated_toast.failed_to_create_dashboard')
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
                            {t('dashboard.default_name')}
                        </CardTitle>
                        <CardDescription>
                            {t('view.dashboard.generated.loading_dashboard_configuration')}
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
                                {t('dashboard.default_name')}
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
                            {t('dashboard.new_dashboard')}
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
                                {t('view.dashboard.generated.open_first_dashboard')}
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    navigate('/feed', { replace: true })
                                }
                            >
                                {t('view.dashboard.generated.back_to_feed')}
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
                        placeholder={t('view.dashboard.generated.dashboard_name')}
                        className="mx-2 h-7 max-w-52 text-sm"
                    />
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={cancelEditing}
                        >
                            <XIcon data-icon="inline-start" />
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={handleDelete}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t('common.actions.delete')}
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
                        {t('common.actions.save')}
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
                                {t('view.dashboard.generated.add_a_row_to_start_building_this_dashboard')}
                            </div>
                        )}

                        <DashboardAddRowControl onAddRow={handleAddRow} />
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
                            <p>{t('dashboard.empty')}</p>
                            <Button
                                type="button"
                                onClick={() => setIsEditing(true)}
                            >
                                {t('dashboard.actions.start_editing')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
