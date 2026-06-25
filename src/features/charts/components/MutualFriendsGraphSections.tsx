import { CheckIcon, RefreshCcwIcon, Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger
} from '@/ui/shadcn/sheet';
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';

import { MUTUAL_GRAPH_LAYOUT_LIMITS } from '../mutual-friends/mutualFriendsSettings';
import {
    GraphEmptyState,
    GraphLoadingState,
    UserPickerRow
} from './MutualFriendsViewParts';

const {
    layoutIterations: LAYOUT_ITERATIONS_LIMITS,
    layoutSpacing: LAYOUT_SPACING_LIMITS,
    edgeCurvature: EDGE_CURVATURE_LIMITS,
    communitySeparation: COMMUNITY_SEPARATION_LIMITS
} = MUTUAL_GRAPH_LAYOUT_LIMITS;

const layoutControls = [
    {
        key: 'layoutIterations',
        labelKey: 'view.charts.mutual_friend.settings.layout_iterations',
        helpKey: 'view.charts.mutual_friend.settings.layout_iterations_help',
        limits: LAYOUT_ITERATIONS_LIMITS,
        step: 100,
        format: (value: any) => value
    },
    {
        key: 'layoutSpacing',
        labelKey: 'view.charts.mutual_friend.settings.layout_spacing',
        helpKey: 'view.charts.mutual_friend.settings.layout_spacing_help',
        limits: LAYOUT_SPACING_LIMITS,
        step: 1,
        format: (value: any) => value
    },
    {
        key: 'edgeCurvature',
        labelKey: 'view.charts.mutual_friend.settings.edge_curvature',
        helpKey: 'view.charts.mutual_friend.settings.edge_curvature_help',
        limits: EDGE_CURVATURE_LIMITS,
        step: 0.01,
        format: (value: any) => value.toFixed(2)
    },
    {
        key: 'communitySeparation',
        labelKey: 'view.charts.mutual_friend.settings.community_separation',
        helpKey: 'view.charts.mutual_friend.settings.community_separation_help',
        limits: COMMUNITY_SEPARATION_LIMITS,
        step: 0.1,
        format: (value: any) => value.toFixed(1)
    }
];

function MutualFriendsNodePicker({
    filteredNodeOptions,
    nodePickerOpen,
    nodeSearchQuery,
    onNodePickerOpenChange,
    onNodeSearchQueryChange,
    onSelectNode,
    selectedNode,
    selectedNodeId
}: any) {
    const { t } = useTranslation();

    return (
        <Popover open={nodePickerOpen} onOpenChange={onNodePickerOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="min-w-60 justify-start px-3 font-normal"
                >
                    <span className="truncate">
                        {selectedNode
                            ? `${selectedNode.label} (${selectedNode.degree})`
                            : t(
                                  'view.charts.mutual_friend.actions.go_to_friend'
                              )}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
                <Input
                    autoFocus
                    value={nodeSearchQuery}
                    onChange={(event: any) =>
                        onNodeSearchQueryChange(event.target.value)
                    }
                    placeholder={t(
                        'view.charts.mutual_friend.actions.go_to_friend'
                    )}
                />
                <ScrollArea className="mt-2 h-72">
                    <div className="flex flex-col gap-1 pr-2">
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-auto w-full justify-start p-1.5 text-left font-normal"
                            onClick={() => {
                                onSelectNode('');
                                onNodePickerOpenChange(false);
                            }}
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {t('view.charts.empty.no_selection')}
                            </span>
                            <CheckIcon
                                data-icon="inline-end"
                                className={cn(
                                    'ml-auto',
                                    selectedNodeId ? 'opacity-0' : 'opacity-100'
                                )}
                            />
                        </Button>
                        {filteredNodeOptions.map((option: any) => (
                            <Button
                                key={option.value}
                                type="button"
                                variant="ghost"
                                className="h-auto w-full justify-start p-0 text-left font-normal"
                                onClick={() => {
                                    onSelectNode(option.value);
                                    onNodePickerOpenChange(false);
                                    onNodeSearchQueryChange('');
                                }}
                            >
                                <UserPickerRow
                                    option={option}
                                    selected={option.value === selectedNodeId}
                                />
                            </Button>
                        ))}
                        {!filteredNodeOptions.length ? (
                            <div className="text-muted-foreground p-3 text-xs">
                                {t(
                                    'view.charts.empty.no_friends_match_this_search'
                                )}
                            </div>
                        ) : null}
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}

function MutualFriendsSettingsSheet({
    edgeCount,
    excludeSearchQuery,
    excludedCount,
    excludedFriendIdSet,
    filteredExcludeOptions,
    layoutSettings,
    nodeCount,
    onExcludeSearchQueryChange,
    onResetLayoutAndHidden,
    onToggleExcludedFriendId,
    setLayoutSetting
}: any) {
    const { t } = useTranslation();

    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={'Graph Layout Settings'}
                >
                    <Settings2Icon data-icon="inline-start" />
                </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-90 overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>
                        {t('view.charts.mutual_friend.settings.title')}
                    </SheetTitle>
                </SheetHeader>
                <div className="grid gap-5 p-4 pt-0 text-sm">
                    {layoutControls.map((control: any) => (
                        <div key={control.key} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <span>{t(control.labelKey)}</span>
                                <span className="text-muted-foreground tabular-nums">
                                    {control.format(
                                        layoutSettings[control.key]
                                    )}
                                </span>
                            </div>
                            <Slider
                                min={control.limits.min}
                                max={control.limits.max}
                                step={control.step}
                                value={[layoutSettings[control.key]]}
                                onValueChange={([value]: any) =>
                                    setLayoutSetting(control.key, value)
                                }
                            />
                            <p className="text-muted-foreground text-xs">
                                {t(control.helpKey)}
                            </p>
                        </div>
                    ))}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <span>
                                {t(
                                    'view.charts.mutual_friend.settings.exclude_friends'
                                )}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                                {excludedCount}
                            </span>
                        </div>
                        <Input
                            value={excludeSearchQuery}
                            onChange={(event: any) =>
                                onExcludeSearchQueryChange(event.target.value)
                            }
                            placeholder={t(
                                'view.charts.mutual_friend.settings.exclude_friends_placeholder'
                            )}
                        />
                        <ScrollArea className="h-72 rounded-md border">
                            <div className="flex flex-col gap-1 p-1 pr-2">
                                {filteredExcludeOptions.map((option: any) => {
                                    const selected = excludedFriendIdSet.has(
                                        option.value
                                    );
                                    return (
                                        <Field
                                            key={option.value}
                                            orientation="horizontal"
                                            className="hover:bg-muted gap-0 rounded-md p-0"
                                        >
                                            <Checkbox
                                                id={`mutual-excluded-friend-${option.value}`}
                                                checked={selected}
                                                onCheckedChange={() =>
                                                    onToggleExcludedFriendId(
                                                        option.value
                                                    )
                                                }
                                                className="ml-2"
                                            />
                                            <FieldLabel
                                                htmlFor={`mutual-excluded-friend-${option.value}`}
                                                className="min-w-0 flex-1 cursor-pointer font-normal"
                                            >
                                                <UserPickerRow
                                                    option={option}
                                                    selected={selected}
                                                    multiple
                                                    showSelection={false}
                                                />
                                            </FieldLabel>
                                        </Field>
                                    );
                                })}
                                {!filteredExcludeOptions.length ? (
                                    <div className="text-muted-foreground p-3 text-xs">
                                        {t(
                                            'view.charts.empty.no_friends_match_this_search'
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        </ScrollArea>
                        <p className="text-muted-foreground text-xs">
                            {t(
                                'view.charts.mutual_friend.settings.exclude_friends_help'
                            )}
                        </p>
                    </div>
                    <div className="text-muted-foreground text-xs">
                        {t('view.charts.label.hidden_nodes')} {excludedCount}
                        <br />
                        {t('view.charts.label.visible_nodes')} {nodeCount}
                        <br />
                        {t('view.charts.label.visible_links')} {edgeCount}
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onResetLayoutAndHidden}
                    >
                        {t('view.charts.mutual_friend.settings.reset_defaults')}
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}

export function MutualFriendsToolbar({
    exclusions,
    fetch,
    graph,
    layout,
    mutualCommands,
    picker
}: any) {
    const { t } = useTranslation();
    const baseNodeCount = graph.baseGraph.nodes.length;
    const fetchProgress = fetch.fetchProgress;
    const isRefreshingSelectedNode = Boolean(
        picker.selectedNode && picker.nodeRefreshId === picker.selectedNode.id
    );
    const isRefreshDisabled = picker.selectedNode
        ? isRefreshingSelectedNode
        : fetchProgress.isFetching;
    const isRefreshBusy =
        isRefreshingSelectedNode ||
        (!picker.selectedNode && fetchProgress.isFetching);
    const handleRefresh = picker.selectedNode
        ? mutualCommands.refreshSelectedNode
        : mutualCommands.refreshPage;

    return (
        <div className="flex w-full items-center gap-3">
            <div className="options-container flex items-center gap-3 bg-transparent pb-3 shadow-none">
                {fetchProgress.isFetching ? (
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={fetchProgress.cancelRequested}
                        onClick={mutualCommands.cancelFetch}
                    >
                        {fetchProgress.cancelRequested
                            ? t('view.charts.mutual_friend.actions.cancelling')
                            : t(
                                  'view.charts.mutual_friend.actions.stop_fetching'
                              )}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        disabled={!graph.currentUserId || !graph.friendCount}
                        onClick={mutualCommands.fetchGraph}
                    >
                        {baseNodeCount
                            ? t('view.charts.mutual_friend.actions.fetch_again')
                            : t(
                                  'view.charts.mutual_friend.actions.start_fetch'
                              )}
                    </Button>
                )}
                {baseNodeCount ? (
                    <MutualFriendsNodePicker
                        filteredNodeOptions={picker.filteredNodeOptions}
                        nodePickerOpen={picker.nodePickerOpen}
                        nodeSearchQuery={picker.nodeSearchQuery}
                        onNodePickerOpenChange={picker.setNodePickerOpen}
                        onNodeSearchQueryChange={picker.setNodeSearchQuery}
                        onSelectNode={mutualCommands.selectNode}
                        selectedNode={picker.selectedNode}
                        selectedNodeId={picker.selectedNodeId}
                    />
                ) : null}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={isRefreshDisabled}
                >
                    {isRefreshBusy ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RefreshCcwIcon data-icon="inline-start" />
                    )}
                    {isRefreshingSelectedNode
                        ? 'Refreshing...'
                        : t('common.actions.refresh')}
                </Button>
                <MutualFriendsSettingsSheet
                    edgeCount={graph.edgeCount}
                    excludeSearchQuery={exclusions.excludeSearchQuery}
                    excludedCount={exclusions.excludedCount}
                    excludedFriendIdSet={exclusions.excludedFriendIdSet}
                    filteredExcludeOptions={exclusions.filteredExcludeOptions}
                    layoutSettings={layout.layoutSettings}
                    nodeCount={graph.nodeCount}
                    onExcludeSearchQueryChange={
                        exclusions.setExcludeSearchQuery
                    }
                    onResetLayoutAndHidden={mutualCommands.resetLayoutAndHidden}
                    onToggleExcludedFriendId={
                        mutualCommands.toggleExcludedFriendId
                    }
                    setLayoutSetting={layout.setLayoutSetting}
                />
            </div>
        </div>
    );
}

export function MutualFriendsGraphStage({
    baseNodeCount,
    detail,
    filteredNodeCount,
    onGraphElementRef,
    status
}: any) {
    const { t } = useTranslation();

    if (status === 'running') {
        return <GraphLoadingState />;
    }
    if (status === 'error') {
        return (
            <GraphEmptyState
                title={t('view.charts.error.mutual_graph_failed_to_load')}
                description={
                    detail ||
                    'The graph adapter could not read the cached mutual-friends tables.'
                }
            />
        );
    }
    if (!baseNodeCount) {
        return (
            <GraphEmptyState
                title={t('view.charts.empty.no_cached_mutual_graph_yet')}
                description={t(
                    'view.charts.description.the_local_mutual_friends_snapshot_is_empty_use_start_fetch_to_build_the_graph_cache'
                )}
            />
        );
    }
    if (!filteredNodeCount) {
        return (
            <GraphEmptyState
                title={t(
                    'view.charts.empty.no_graph_nodes_match_the_current_search'
                )}
                description={t(
                    'view.charts.label.try_a_broader_search_term_or_clear_the_node_filter'
                )}
            />
        );
    }
    return (
        <div
            ref={onGraphElementRef}
            className="h-[calc(100vh-260px)] min-h-[520px] w-full flex-1 rounded-lg bg-transparent"
        />
    );
}
