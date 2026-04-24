import {
    CheckIcon,
    EyeOffIcon,
    RefreshCcwIcon,
    Settings2Icon,
    UserIcon
} from 'lucide-react';

import { cn } from '@/lib/utils.js';
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

import { MUTUAL_GRAPH_LAYOUT_LIMITS } from '../mutual-friends/mutualFriendsSettings.js';
import {
    GraphEmptyState,
    GraphLoadingState,
    UserPickerRow
} from './MutualFriendsViewParts.jsx';

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
        limits: LAYOUT_ITERATIONS_LIMITS,
        step: 100,
        format: (value) => value
    },
    {
        key: 'layoutSpacing',
        labelKey: 'view.charts.mutual_friend.settings.layout_spacing',
        limits: LAYOUT_SPACING_LIMITS,
        step: 1,
        format: (value) => value
    },
    {
        key: 'edgeCurvature',
        labelKey: 'view.charts.mutual_friend.settings.edge_curvature',
        limits: EDGE_CURVATURE_LIMITS,
        step: 0.01,
        format: (value) => value.toFixed(2)
    },
    {
        key: 'communitySeparation',
        labelKey: 'view.charts.mutual_friend.settings.community_separation',
        limits: COMMUNITY_SEPARATION_LIMITS,
        step: 0.1,
        format: (value) => value.toFixed(1)
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
    selectedNodeId,
    t
}) {
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
                    onChange={(event) =>
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
                                {t('view.charts.generated.no_selection')}
                            </span>
                            <CheckIcon
                                data-icon="inline-end"
                                className={cn(
                                    'ml-auto',
                                    selectedNodeId ? 'opacity-0' : 'opacity-100'
                                )}
                            />
                        </Button>
                        {filteredNodeOptions.map((option) => (
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
                                    'view.charts.generated.no_friends_match_this_search'
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
    setLayoutSetting,
    t
}) {
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
                    {layoutControls.map((control) => (
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
                                onValueChange={([value]) =>
                                    setLayoutSetting(control.key, value)
                                }
                            />
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
                            onChange={(event) =>
                                onExcludeSearchQueryChange(event.target.value)
                            }
                            placeholder={t(
                                'view.charts.mutual_friend.settings.exclude_friends_placeholder'
                            )}
                        />
                        <ScrollArea className="h-72 rounded-md border">
                            <div className="flex flex-col gap-1 p-1 pr-2">
                                {filteredExcludeOptions.map((option) => {
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
                                            'view.charts.generated.no_friends_match_this_search'
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
                        {t('view.charts.generated.hidden_nodes')}{' '}
                        {excludedCount}. Visible nodes: {nodeCount}. Visible
                        links: {edgeCount}.
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
    baseNodeCount,
    currentUserId,
    edgeCount,
    excludeSearchQuery,
    excludedCount,
    excludedFriendIdSet,
    fetchProgress,
    filteredExcludeOptions,
    filteredNodeOptions,
    friendCount,
    layoutSettings,
    nodeCount,
    nodePickerOpen,
    nodeRefreshId,
    nodeSearchQuery,
    onCancelFetch,
    onExcludeSearchQueryChange,
    onFetchGraph,
    onHideSelectedNode,
    onNodePickerOpenChange,
    onNodeSearchQueryChange,
    onOpenSelectedNode,
    onRefreshPage,
    onRefreshSelectedNode,
    onResetLayoutAndHidden,
    onSelectNode,
    onToggleExcludedFriendId,
    selectedNode,
    selectedNodeId,
    setLayoutSetting,
    t
}) {
    return (
        <div className="flex w-full items-center gap-3">
            <div className="options-container flex items-center gap-3 bg-transparent pb-3 shadow-none">
                {fetchProgress.isFetching ? (
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={fetchProgress.cancelRequested}
                        onClick={onCancelFetch}
                    >
                        {fetchProgress.cancelRequested
                            ? 'Cancelling...'
                            : 'Stop fetching'}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        disabled={!currentUserId || !friendCount}
                        onClick={onFetchGraph}
                    >
                        {baseNodeCount ? 'Fetch again' : 'Start fetch'}
                    </Button>
                )}
                {baseNodeCount ? (
                    <MutualFriendsNodePicker
                        filteredNodeOptions={filteredNodeOptions}
                        nodePickerOpen={nodePickerOpen}
                        nodeSearchQuery={nodeSearchQuery}
                        onNodePickerOpenChange={onNodePickerOpenChange}
                        onNodeSearchQueryChange={onNodeSearchQueryChange}
                        onSelectNode={onSelectNode}
                        selectedNode={selectedNode}
                        selectedNodeId={selectedNodeId}
                        t={t}
                    />
                ) : null}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
                {selectedNode ? (
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onOpenSelectedNode}
                        >
                            <UserIcon data-icon="inline-start" />
                            {t('common.actions.open')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={nodeRefreshId === selectedNode.id}
                            onClick={onRefreshSelectedNode}
                        >
                            {nodeRefreshId === selectedNode.id ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <RefreshCcwIcon data-icon="inline-start" />
                            )}
                            {nodeRefreshId === selectedNode.id
                                ? 'Refreshing...'
                                : 'Refresh'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onHideSelectedNode}
                        >
                            <EyeOffIcon data-icon="inline-start" />
                            {t('nav_menu.custom_nav.hide')}
                        </Button>
                    </>
                ) : null}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={'Refresh mutual graph'}
                    onClick={onRefreshPage}
                    disabled={fetchProgress.isFetching}
                >
                    {fetchProgress.isFetching ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RefreshCcwIcon data-icon="inline-start" />
                    )}
                </Button>
                <MutualFriendsSettingsSheet
                    edgeCount={edgeCount}
                    excludeSearchQuery={excludeSearchQuery}
                    excludedCount={excludedCount}
                    excludedFriendIdSet={excludedFriendIdSet}
                    filteredExcludeOptions={filteredExcludeOptions}
                    layoutSettings={layoutSettings}
                    nodeCount={nodeCount}
                    onExcludeSearchQueryChange={onExcludeSearchQueryChange}
                    onResetLayoutAndHidden={onResetLayoutAndHidden}
                    onToggleExcludedFriendId={onToggleExcludedFriendId}
                    setLayoutSetting={setLayoutSetting}
                    t={t}
                />
            </div>
        </div>
    );
}

export function MutualFriendsFetchProgress({ fetchProgress, progressPercent }) {
    if (!fetchProgress.isFetching) {
        return null;
    }
    return (
        <div className="grid w-70 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-center rounded-md bg-transparent p-3">
            <div className="mb-1 flex justify-between text-sm">
                <span>{Math.round(progressPercent)}%</span>
                <strong>
                    {fetchProgress.processedFriends} /{' '}
                    {fetchProgress.totalFriends}
                </strong>
            </div>
            <div className="bg-muted h-3 overflow-hidden rounded-full">
                <div
                    className="bg-primary h-full transition-[width]"
                    style={{ width: `${progressPercent}%` }}
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
    status,
    t
}) {
    if (status === 'running') {
        return <GraphLoadingState />;
    }
    if (status === 'error') {
        return (
            <GraphEmptyState
                title={t('view.charts.generated.mutual_graph_failed_to_load')}
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
                title={t('view.charts.generated.no_cached_mutual_graph_yet')}
                description={t(
                    'view.charts.generated.the_local_mutual_friends_snapshot_is_empty_use_start_fetch_t'
                )}
            />
        );
    }
    if (!filteredNodeCount) {
        return (
            <GraphEmptyState
                title={t(
                    'view.charts.generated.no_graph_nodes_match_the_current_search'
                )}
                description={t(
                    'view.charts.generated.try_a_broader_search_term_or_clear_the_node_filter'
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
