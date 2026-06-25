import { PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    FEED_FILTER_TYPES,
    type FeedFilterType
} from '@/repositories/feedRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
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
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldGroup,
    FieldLabel,
    FieldSet,
    FieldLegend
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import {
    buildFeedFavoriteGroupOptions,
    describeFeedColumnScope
} from '../feedColumnScope';
import {
    copyFeedColumnExclusion,
    createFeedColumnsPresetConfig,
    createFeedColumnConfig,
    type FeedColumnConfig,
    type FeedColumnFavoriteGroupSelection,
    type FeedColumnFriendScope
} from '../feedColumnsState';

type FeedColumnsManagerDialogProps = {
    columns: FeedColumnConfig[];
    onColumnsChange(columns: FeedColumnConfig[]): void;
    onOpenChange(open: boolean): void;
    onSelectedColumnIdChange(columnId: string): void;
    open: boolean;
    selectedColumnId: string;
};

function toggleValue<T>(values: T[], value: T) {
    return values.includes(value)
        ? values.filter((entry) => entry !== value)
        : [...values, value];
}

function resolveScopeSelectValue(scope: FeedColumnFriendScope) {
    if (scope.kind === 'all') {
        return 'all';
    }
    return scope.groupKeys === 'all' ? 'favorites-all' : 'favorites-selected';
}

function resolveExcludedFavoriteGroupSelectValue(scope: FeedColumnFriendScope) {
    const excludedGroupKeys = scope.excludedFavoriteGroupKeys;
    if (excludedGroupKeys === 'all') {
        return 'exclude-all';
    }
    return Array.isArray(excludedGroupKeys) && excludedGroupKeys.length
        ? 'exclude-selected'
        : 'exclude-none';
}

function withExcludedFavoriteGroups(
    scope: FeedColumnFriendScope,
    excludedFavoriteGroupKeys: FeedColumnFavoriteGroupSelection | undefined
): FeedColumnFriendScope {
    if (!excludedFavoriteGroupKeys) {
        const { excludedFavoriteGroupKeys: _excluded, ...nextScope } = scope;
        return nextScope;
    }
    return {
        ...scope,
        excludedFavoriteGroupKeys
    };
}

export function FeedColumnsManagerDialog({
    columns,
    onColumnsChange,
    onOpenChange,
    onSelectedColumnIdChange,
    open,
    selectedColumnId
}: FeedColumnsManagerDialogProps) {
    const { t } = useTranslation();
    const [draftColumns, setDraftColumns] =
        useState<FeedColumnConfig[]>(columns);
    const [draftSelectedColumnId, setDraftSelectedColumnId] =
        useState(selectedColumnId);
    const [restorePresetPromptOpen, setRestorePresetPromptOpen] =
        useState(false);
    const favoriteFriendGroups = useFavoriteStore(
        (state: any) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state: any) => state.localFriendFavoriteGroups
    );
    const favoriteGroupOptions = useMemo(
        () =>
            buildFeedFavoriteGroupOptions({
                favoriteFriendGroups,
                localFriendFavoriteGroups
            }),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );

    useEffect(() => {
        if (!open) {
            return;
        }
        setDraftColumns(columns);
        setDraftSelectedColumnId(selectedColumnId || columns[0]?.id || '');
    }, [columns, open, selectedColumnId]);

    const selectedColumn =
        draftColumns.find((column) => column.id === draftSelectedColumnId) ||
        draftColumns[0];
    const describeColumn = (column: FeedColumnConfig) =>
        describeFeedColumnScope(column, {
            allFavoritesLabel: t('view.feed.columns.all_favorites'),
            allFriendsLabel: t('view.feed.columns.all_friends'),
            excludedAllFavoritesLabel: t(
                'view.feed.columns.except_all_favorites'
            ),
            excludedGroupCountLabel: (count) =>
                t('view.feed.columns.except_groups_count', { count }),
            groupCountLabel: (count) =>
                t('view.feed.columns.groups_count', { count }),
            typeLabel: (type) => t(`view.feed.filters.${type}`)
        });

    const commitDraftColumns = () => {
        const nextSelectedColumnId = draftColumns.some(
            (column) => column.id === draftSelectedColumnId
        )
            ? draftSelectedColumnId
            : draftColumns[0]?.id || '';
        onColumnsChange(draftColumns);
        onSelectedColumnIdChange(nextSelectedColumnId);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && open) {
            commitDraftColumns();
        }
        onOpenChange(nextOpen);
    };

    const updateSelectedColumn = (patch: Partial<FeedColumnConfig>) => {
        if (!selectedColumn) {
            return;
        }
        setDraftColumns((currentColumns) =>
            currentColumns.map((column) =>
                column.id === selectedColumn.id
                    ? {
                          ...column,
                          ...patch
                      }
                    : column
            )
        );
    };
    const addColumn = () => {
        const nextColumn = createFeedColumnConfig({
            title: t('view.feed.columns.new_column')
        });
        setDraftColumns((currentColumns) => [...currentColumns, nextColumn]);
        setDraftSelectedColumnId(nextColumn.id);
    };
    const deleteColumn = (columnId: string) => {
        if (draftColumns.length <= 1) {
            setRestorePresetPromptOpen(true);
            return;
        }
        const nextColumns = draftColumns.filter(
            (column) => column.id !== columnId
        );
        setDraftColumns(nextColumns);
        if (draftSelectedColumnId === columnId) {
            setDraftSelectedColumnId(nextColumns[0]?.id || '');
        }
    };
    const restorePresetColumns = () => {
        const presetColumns = createFeedColumnsPresetConfig();
        setDraftColumns(presetColumns);
        setDraftSelectedColumnId(presetColumns[0]?.id || '');
    };

    const selectedGroupKeys =
        selectedColumn?.friendScope.kind === 'favorites' &&
        selectedColumn.friendScope.groupKeys !== 'all'
            ? selectedColumn.friendScope.groupKeys
            : [];
    const selectedExcludedGroupKeys = Array.isArray(
        selectedColumn?.friendScope.excludedFavoriteGroupKeys
    )
        ? selectedColumn.friendScope.excludedFavoriteGroupKeys
        : [];

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="w-[min(94vw,60rem)] sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('view.feed.columns.manage')}</DialogTitle>
                </DialogHeader>
                <div className="grid min-h-96 min-w-0 grid-cols-[18rem_1fr] gap-4">
                    <div className="border-border flex min-h-0 flex-col gap-1 rounded-lg border p-1">
                        <div className="flex shrink-0 items-center gap-1 px-1 py-0.5">
                            <div className="text-muted-foreground min-w-0 flex-1 truncate text-xs font-medium">
                                {t('view.feed.columns.manage')}
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                aria-label={t('view.feed.columns.add')}
                                onClick={addColumn}
                            >
                                <PlusIcon data-icon="icon" />
                            </Button>
                        </div>
                        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
                            {draftColumns.map((column) => (
                                <div
                                    key={column.id}
                                    className="flex min-w-0 items-center gap-1"
                                >
                                    <Button
                                        type="button"
                                        variant={
                                            column.id === selectedColumn?.id
                                                ? 'secondary'
                                                : 'ghost'
                                        }
                                        className="h-auto min-w-0 flex-1 justify-start px-2 py-1.5 text-left"
                                        onClick={() =>
                                            setDraftSelectedColumnId(column.id)
                                        }
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm">
                                                {column.title}
                                            </span>
                                            <span className="text-muted-foreground block truncate text-xs">
                                                {describeColumn(column)}
                                            </span>
                                        </span>
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t('common.actions.delete')}
                                        onClick={() => deleteColumn(column.id)}
                                    >
                                        <Trash2Icon data-icon="icon" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                    {selectedColumn ? (
                        <FieldGroup className="gap-4 overflow-y-auto pr-1">
                            <Field>
                                <FieldLabel htmlFor="feed-column-title">
                                    {t('view.feed.columns.title')}
                                </FieldLabel>
                                <Input
                                    id="feed-column-title"
                                    value={selectedColumn.title}
                                    onChange={(event) =>
                                        updateSelectedColumn({
                                            title: event.currentTarget.value
                                        })
                                    }
                                />
                            </Field>
                            <Field>
                                <FieldLabel>
                                    {t('view.feed.columns.scope')}
                                </FieldLabel>
                                <Select
                                    value={resolveScopeSelectValue(
                                        selectedColumn.friendScope
                                    )}
                                    onValueChange={(value) => {
                                        if (value === 'all') {
                                            updateSelectedColumn({
                                                friendScope:
                                                    copyFeedColumnExclusion(
                                                        selectedColumn.friendScope,
                                                        { kind: 'all' }
                                                    )
                                            });
                                        } else if (value === 'favorites-all') {
                                            updateSelectedColumn({
                                                friendScope:
                                                    copyFeedColumnExclusion(
                                                        selectedColumn.friendScope,
                                                        {
                                                            kind: 'favorites',
                                                            groupKeys: 'all'
                                                        }
                                                    )
                                            });
                                        } else {
                                            updateSelectedColumn({
                                                friendScope:
                                                    copyFeedColumnExclusion(
                                                        selectedColumn.friendScope,
                                                        {
                                                            kind: 'favorites',
                                                            groupKeys:
                                                                selectedGroupKeys.length
                                                                    ? selectedGroupKeys
                                                                    : favoriteGroupOptions
                                                                          .slice(
                                                                              0,
                                                                              1
                                                                          )
                                                                          .map(
                                                                              (
                                                                                  group
                                                                              ) =>
                                                                                  group.key
                                                                          )
                                                        }
                                                    )
                                            });
                                        }
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="all">
                                                {t(
                                                    'view.feed.columns.all_friends'
                                                )}
                                            </SelectItem>
                                            <SelectItem value="favorites-all">
                                                {t(
                                                    'view.feed.columns.all_favorites'
                                                )}
                                            </SelectItem>
                                            <SelectItem value="favorites-selected">
                                                {t(
                                                    'view.feed.columns.selected_favorites'
                                                )}
                                            </SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel>
                                    {t('view.feed.columns.exclude_favorites')}
                                </FieldLabel>
                                <Select
                                    value={resolveExcludedFavoriteGroupSelectValue(
                                        selectedColumn.friendScope
                                    )}
                                    onValueChange={(value) => {
                                        if (value === 'exclude-all') {
                                            updateSelectedColumn({
                                                friendScope:
                                                    withExcludedFavoriteGroups(
                                                        selectedColumn.friendScope,
                                                        'all'
                                                    )
                                            });
                                        } else if (
                                            value === 'exclude-selected'
                                        ) {
                                            updateSelectedColumn({
                                                friendScope:
                                                    withExcludedFavoriteGroups(
                                                        selectedColumn.friendScope,
                                                        selectedExcludedGroupKeys.length
                                                            ? selectedExcludedGroupKeys
                                                            : favoriteGroupOptions
                                                                  .slice(0, 1)
                                                                  .map(
                                                                      (group) =>
                                                                          group.key
                                                                  )
                                                    )
                                            });
                                        } else {
                                            updateSelectedColumn({
                                                friendScope:
                                                    withExcludedFavoriteGroups(
                                                        selectedColumn.friendScope,
                                                        undefined
                                                    )
                                            });
                                        }
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="exclude-none">
                                                {t(
                                                    'view.feed.columns.exclude_none'
                                                )}
                                            </SelectItem>
                                            <SelectItem value="exclude-all">
                                                {t(
                                                    'view.feed.columns.exclude_all_favorites'
                                                )}
                                            </SelectItem>
                                            <SelectItem value="exclude-selected">
                                                {t(
                                                    'view.feed.columns.exclude_selected_favorites'
                                                )}
                                            </SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            {resolveScopeSelectValue(
                                selectedColumn.friendScope
                            ) === 'favorites-selected' ? (
                                <FieldSet>
                                    <FieldLegend variant="label">
                                        {t('view.feed.columns.favorite_groups')}
                                    </FieldLegend>
                                    <div className="grid grid-cols-2 gap-2">
                                        {favoriteGroupOptions.map((group) => (
                                            <Field
                                                key={group.key}
                                                orientation="horizontal"
                                            >
                                                <Checkbox
                                                    checked={selectedGroupKeys.includes(
                                                        group.key
                                                    )}
                                                    onCheckedChange={() =>
                                                        updateSelectedColumn({
                                                            friendScope:
                                                                copyFeedColumnExclusion(
                                                                    selectedColumn.friendScope,
                                                                    {
                                                                        kind: 'favorites',
                                                                        groupKeys:
                                                                            toggleValue(
                                                                                selectedGroupKeys,
                                                                                group.key
                                                                            )
                                                                    }
                                                                )
                                                        })
                                                    }
                                                />
                                                <FieldLabel className="min-w-0 truncate">
                                                    {group.label}
                                                </FieldLabel>
                                            </Field>
                                        ))}
                                    </div>
                                </FieldSet>
                            ) : null}
                            {resolveExcludedFavoriteGroupSelectValue(
                                selectedColumn.friendScope
                            ) === 'exclude-selected' ? (
                                <FieldSet>
                                    <FieldLegend variant="label">
                                        {t(
                                            'view.feed.columns.excluded_favorite_groups'
                                        )}
                                    </FieldLegend>
                                    <div className="grid grid-cols-2 gap-2">
                                        {favoriteGroupOptions.map((group) => (
                                            <Field
                                                key={group.key}
                                                orientation="horizontal"
                                            >
                                                <Checkbox
                                                    checked={selectedExcludedGroupKeys.includes(
                                                        group.key
                                                    )}
                                                    onCheckedChange={() => {
                                                        const nextGroupKeys =
                                                            toggleValue(
                                                                selectedExcludedGroupKeys,
                                                                group.key
                                                            );
                                                        updateSelectedColumn({
                                                            friendScope:
                                                                withExcludedFavoriteGroups(
                                                                    selectedColumn.friendScope,
                                                                    nextGroupKeys.length
                                                                        ? nextGroupKeys
                                                                        : undefined
                                                                )
                                                        });
                                                    }}
                                                />
                                                <FieldLabel className="min-w-0 truncate">
                                                    {group.label}
                                                </FieldLabel>
                                            </Field>
                                        ))}
                                    </div>
                                </FieldSet>
                            ) : null}
                            <FieldSet>
                                <FieldLegend variant="label">
                                    {t('view.feed.columns.types')}
                                </FieldLegend>
                                <div className="grid grid-cols-3 gap-2">
                                    {FEED_FILTER_TYPES.map((type) => (
                                        <Field
                                            key={type}
                                            orientation="horizontal"
                                        >
                                            <Checkbox
                                                checked={selectedColumn.feedTypes.includes(
                                                    type
                                                )}
                                                onCheckedChange={() => {
                                                    const nextTypes =
                                                        toggleValue(
                                                            selectedColumn.feedTypes,
                                                            type
                                                        ) as FeedFilterType[];
                                                    if (nextTypes.length) {
                                                        updateSelectedColumn({
                                                            feedTypes: nextTypes
                                                        });
                                                    }
                                                }}
                                            />
                                            <FieldLabel>
                                                {t(`view.feed.filters.${type}`)}
                                            </FieldLabel>
                                        </Field>
                                    ))}
                                </div>
                            </FieldSet>
                        </FieldGroup>
                    ) : null}
                </div>
                <DialogFooter className="sm:justify-between">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={restorePresetColumns}
                    >
                        <RotateCcwIcon data-icon="inline-start" />
                        {t('view.feed.columns.restore_preset')}
                    </Button>
                    <DialogClose asChild>
                        <Button type="button">
                            {t('common.actions.save')}
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
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
        </Dialog>
    );
}
