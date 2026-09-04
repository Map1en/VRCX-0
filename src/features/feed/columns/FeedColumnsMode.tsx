import {
    closestCenter,
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
    arrayMove,
    horizontalListSortingStrategy,
    SortableContext,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ListPlusIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import {
    ToolbarActions,
    ToolbarViewMenu,
    ToolbarViews
} from '@/components/layout/ToolbarControls';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/state/preferencesStore';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog';
import {
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator
} from '@/ui/shadcn/dropdown-menu';

import { FeedPersistenceDisabledIndicator } from '../components/FeedPersistenceDisabledIndicator';
import { FeedViewModeToggle } from '../components/FeedViewModeToggle';
import {
    FEED_COLUMN_DENSITY_OPTIONS,
    type FeedColumnDensity,
    getFeedColumnDensityConfig,
    sanitizeFeedColumnDensity
} from '../feedColumnsDensity';
import {
    createFeedColumnsPresetConfig,
    type FeedColumnConfig,
    type FeedViewMode
} from '../feedColumnsState';
import { useFeedFriendActions } from '../useFeedFriendActions';
import { useFeedPreviousInstancesDialog } from '../useFeedPreviousInstancesDialog';
import { useFeedTimeDisplayMode } from '../useFeedTimeDisplayMode';
import { FeedColumnPane } from './FeedColumnPane';
import { FeedColumnsManagerDialog } from './FeedColumnsManagerDialog';

type FeedColumnsModeProps = {
    columns: FeedColumnConfig[];
    density: FeedColumnDensity;
    onViewModeChange(value: FeedViewMode): void;
    onColumnsChange(columns: FeedColumnConfig[]): void;
    onDensityChange(value: FeedColumnDensity): void;
};

type SortableFeedColumnProps = {
    children(props: {
        attributes: ReturnType<typeof useSortable>['attributes'];
        isDragging: boolean;
        listeners: NonNullable<ReturnType<typeof useSortable>['listeners']>;
        setNodeRef(node: HTMLElement | null): void;
        style: CSSProperties;
    }): ReactNode;
    columnId: string;
};

function SortableFeedColumn({ children, columnId }: SortableFeedColumnProps) {
    const {
        attributes,
        isDragging,
        listeners,
        setNodeRef,
        transform,
        transition
    } = useSortable({ id: columnId });
    return children({
        attributes,
        isDragging,
        listeners: listeners || {},
        setNodeRef,
        style: {
            transform: CSS.Transform.toString(transform),
            transition
        }
    });
}

function useFeedTimeTicker() {
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const updateNow = () => setNowMs(Date.now());
        let intervalId: number | undefined;
        const timeoutId = window.setTimeout(
            () => {
                updateNow();
                intervalId = window.setInterval(updateNow, 1000);
            },
            1000 - (Date.now() % 1000)
        );

        return () => {
            window.clearTimeout(timeoutId);
            if (intervalId) {
                window.clearInterval(intervalId);
            }
        };
    }, []);

    return nowMs;
}

function FeedColumnsSettingsMenu({
    density,
    onDensityChange,
    onManageColumns
}: {
    density: FeedColumnDensity;
    onDensityChange(value: FeedColumnDensity): void;
    onManageColumns(): void;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarViewMenu>
            <DropdownMenuGroup>
                <DropdownMenuLabel>
                    {t('view.feed.columns.density')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={density}
                    onValueChange={(value: unknown) =>
                        onDensityChange(sanitizeFeedColumnDensity(value))
                    }
                >
                    {FEED_COLUMN_DENSITY_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                            key={option.value}
                            value={option.value}
                            closeOnClick={false}
                        >
                            {t(option.labelKey)}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
                <DropdownMenuItem onClick={onManageColumns}>
                    <ListPlusIcon />
                    {t('view.feed.columns.manage_list')}
                </DropdownMenuItem>
            </DropdownMenuGroup>
        </ToolbarViewMenu>
    );
}

export function FeedColumnsMode({
    columns,
    density,
    onViewModeChange,
    onColumnsChange,
    onDensityChange
}: FeedColumnsModeProps) {
    const { t } = useTranslation();
    const feedPersistenceDisabled = usePreferencesStore(
        (state) => state.feedPersistenceDisabled
    );
    const friendActions = useFeedFriendActions();
    const previousInstancesDialog = useFeedPreviousInstancesDialog();
    const timeDisplayMode = useFeedTimeDisplayMode();
    const nowMs = useFeedTimeTicker();
    const densityConfig = getFeedColumnDensityConfig(density);
    const [managerOpen, setManagerOpen] = useState(false);
    const [restorePresetPromptOpen, setRestorePresetPromptOpen] =
        useState(false);
    const [selectedColumnId, setSelectedColumnId] = useState(
        columns[0]?.id || ''
    );
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 6 }
        })
    );
    const orderedColumns = columns;

    useEffect(() => {
        if (!selectedColumnId && columns[0]?.id) {
            setSelectedColumnId(columns[0].id);
        } else if (
            selectedColumnId &&
            !columns.some((column) => column.id === selectedColumnId)
        ) {
            setSelectedColumnId(columns[0]?.id || '');
        }
    }, [columns, selectedColumnId]);

    const deleteColumn = (columnId: string) => {
        if (columns.length <= 1) {
            setRestorePresetPromptOpen(true);
            return;
        }
        const nextColumns = columns.filter((column) => column.id !== columnId);
        onColumnsChange(nextColumns);
        if (selectedColumnId === columnId) {
            setSelectedColumnId(nextColumns[0]?.id || '');
        }
    };
    const restorePresetColumns = () => {
        const presetColumns = createFeedColumnsPresetConfig();
        onColumnsChange(presetColumns);
        setSelectedColumnId(presetColumns[0]?.id || '');
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : '';
        if (!overId || activeId === overId) {
            return;
        }
        const currentOrder = orderedColumns.map((column) => column.id);
        const oldIndex = currentOrder.indexOf(activeId);
        const newIndex = currentOrder.indexOf(overId);
        if (oldIndex < 0 || newIndex < 0) {
            return;
        }
        const nextOrder = arrayMove(currentOrder, oldIndex, newIndex);
        const byId = new Map(columns.map((column) => [column.id, column]));
        onColumnsChange(
            nextOrder
                .map((columnId) => byId.get(columnId))
                .filter(
                    (column): column is FeedColumnConfig => column !== undefined
                )
        );
    };

    return (
        <>
            <PageToolbar>
                <PageToolbarRow>
                    <ToolbarViews>
                        <FeedViewModeToggle
                            value="columns"
                            onValueChange={onViewModeChange}
                        />
                    </ToolbarViews>
                    <ToolbarActions>
                        {feedPersistenceDisabled ? (
                            <FeedPersistenceDisabledIndicator />
                        ) : null}
                        <FeedColumnsSettingsMenu
                            density={density}
                            onDensityChange={onDensityChange}
                            onManageColumns={() => {
                                setSelectedColumnId(
                                    selectedColumnId ||
                                        orderedColumns[0]?.id ||
                                        ''
                                );
                                setManagerOpen(true);
                            }}
                        />
                    </ToolbarActions>
                </PageToolbarRow>
            </PageToolbar>
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    modifiers={[restrictToHorizontalAxis]}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={orderedColumns.map((column) => column.id)}
                        strategy={horizontalListSortingStrategy}
                    >
                        <div className="flex h-full min-w-max gap-1.5 pb-1">
                            {orderedColumns.map((column) => (
                                <SortableFeedColumn
                                    key={column.id}
                                    columnId={column.id}
                                >
                                    {({
                                        attributes,
                                        isDragging,
                                        listeners,
                                        setNodeRef,
                                        style
                                    }) => (
                                        <div
                                            ref={setNodeRef}
                                            className={cn(
                                                'h-full',
                                                isDragging && 'opacity-60'
                                            )}
                                            style={style}
                                        >
                                            <FeedColumnPane
                                                actions={friendActions}
                                                column={column}
                                                densityConfig={densityConfig}
                                                dragHandleProps={{
                                                    attributes,
                                                    listeners
                                                }}
                                                loadingPreviousInstancesKey={
                                                    previousInstancesDialog.loadingKey
                                                }
                                                nowMs={nowMs}
                                                onDelete={deleteColumn}
                                                onEdit={(columnId) => {
                                                    setSelectedColumnId(
                                                        columnId
                                                    );
                                                    setManagerOpen(true);
                                                }}
                                                onOpenPreviousInstances={
                                                    previousInstancesDialog.openPreviousInstancesForLocation
                                                }
                                                timeDisplayMode={
                                                    timeDisplayMode
                                                }
                                            />
                                        </div>
                                    )}
                                </SortableFeedColumn>
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            </div>
            <FeedColumnsManagerDialog
                columns={columns}
                onColumnsChange={onColumnsChange}
                onOpenChange={setManagerOpen}
                onSelectedColumnIdChange={setSelectedColumnId}
                open={managerOpen}
                selectedColumnId={selectedColumnId}
            />
            <AlertDialog
                open={restorePresetPromptOpen}
                onOpenChange={setRestorePresetPromptOpen}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('view.feed.columns.restore_preset_title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('view.feed.columns.restore_preset_description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            {t('common.actions.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={restorePresetColumns}>
                            {t('view.feed.columns.restore_preset_confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <PreviousInstancesTableDialog
                open={previousInstancesDialog.open}
                onOpenChange={previousInstancesDialog.setOpen}
                title={previousInstancesDialog.title}
                instances={previousInstancesDialog.rows}
                onRowsChange={previousInstancesDialog.setRows}
            />
        </>
    );
}
