import { EyeOffIcon, UsersIcon, type LucideIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { CurrentInstanceBadge } from '@/components/instances/CurrentInstanceBadge';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { InstanceVisitedBadge } from '@/components/instances/InstanceVisitedBadge';
import { useLanguageNames } from '@/components/language/useLanguageNames';
import {
    ToolbarFilterMenu,
    ToolbarRefreshButton
} from '@/components/layout/ToolbarControls';
import { normalizeLocationText } from '@/components/location/locationModel';
import type { WorldProfileRecord } from '@/domain/entities/world';
import { useStableCommands } from '@/lib/useStableCommands';
import { cn } from '@/lib/utils';
import type {
    InstanceCreateOption,
    InstanceCreateOptions
} from '@/platform/tauri/bindings';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { isRecord } from '@/shared/utils/record';
import { structuralEqual } from '@/shared/utils/structuralEqual';
import {
    DropdownMenuCheckboxItem,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator
} from '@/ui/shadcn/dropdown-menu';
import { Toggle } from '@/ui/shadcn/toggle';

import {
    InstanceUserTiles,
    WorldInstancesEmptyState,
    resolveLaunchLocation,
    type WorldDialogInstanceRow
} from './WorldDialogViewParts';
import { instanceCreateOptionLabel } from './worldInstanceCreateOptions';
import {
    EMPTY_WORLD_INSTANCE_FILTER,
    activeWorldInstanceFilterCount,
    filterWorldInstanceRows,
    worldInstanceFilterOptions,
    worldInstanceOccupancy,
    type WorldInstanceFilter
} from './worldInstanceFilters';
import { WorldInstanceRowTitle } from './WorldInstanceRowTitle';
import { WorldSidebarPinButton } from './WorldSidebarPinButton';

function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function WorldInstanceQuickFilter({
    icon: Icon,
    label,
    pressed,
    onPressedChange
}: {
    icon: LucideIcon;
    label: string;
    pressed: boolean;
    onPressedChange: (pressed: boolean) => void;
}) {
    return (
        <Toggle
            pressed={pressed}
            onPressedChange={onPressedChange}
            className="text-muted-foreground hover:text-foreground data-pressed:text-foreground px-2.5"
        >
            <Icon />
            {label}
        </Toggle>
    );
}

function toggle(values: string[], value: string, checked: boolean) {
    return checked
        ? [...values.filter((item) => item !== value), value]
        : values.filter((item) => item !== value);
}

type WorldInstanceRowProps = {
    instance: WorldDialogInstanceRow;
    tags: string[];
    worldId: string;
    worldName: string;
    worldCapacity: number;
    currentUserId: string | null;
    worldDialogShortName: string;
    visibleInstanceUserIds: ReadonlySet<string>;
    showHistory: boolean;
    onShowHistory: () => void;
};

const WorldInstanceRow = memo(
    function WorldInstanceRow({
        instance,
        tags,
        worldId,
        worldName,
        worldCapacity,
        currentUserId,
        worldDialogShortName,
        visibleInstanceUserIds,
        showHistory,
        onShowHistory
    }: WorldInstanceRowProps) {
        const instanceRecord = record(instance);
        const instanceRef = record(instance.ref);
        const instanceGroup = record(instance.group);
        const instanceWorld = record(instanceRecord.world);
        const location = resolveLaunchLocation({ id: worldId }, instance);
        const shortName = normalizeLocationText(instance.shortName);
        const launchToken =
            shortName || normalizeLocationText(instance.secureName);
        const { playerCount, capacity } = worldInstanceOccupancy(
            instance,
            worldCapacity
        );
        const isClosed = Boolean(
            instanceRef.closedAt || instanceRecord.closedAt
        );
        return (
            <div
                className={cn(
                    'group/row border-border/40 hover:bg-muted/25 border-b px-3 py-2 text-sm transition-colors last:border-b-0',
                    isClosed && 'opacity-60'
                )}
            >
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-1.5">
                        <WorldInstanceRowTitle
                            location={location}
                            displayName={normalizeLocationText(
                                instanceRef.displayName ||
                                    instanceRecord.displayName
                            )}
                            description={normalizeLocationText(
                                instanceRef.description
                            )}
                            tags={tags}
                            languageSource={{
                                ...instanceRef,
                                ...instanceRecord
                            }}
                            locationWorldProps={{
                                locationObject: {
                                    ...instanceRef,
                                    ...instance,
                                    tag: location,
                                    location,
                                    shortName,
                                    launchToken
                                },
                                currentUserId,
                                worldDialogShortName,
                                grouphint:
                                    normalizeLocationText(
                                        instanceRecord.groupName
                                    ) ||
                                    normalizeLocationText(instanceGroup.name),
                                playerCount,
                                capacity,
                                showWorldName: false,
                                showPlayerSummary: false,
                                hint:
                                    worldName ||
                                    normalizeLocationText(
                                        instanceRecord.worldName
                                    ) ||
                                    normalizeLocationText(instanceWorld.name)
                            }}
                        />
                        {instance.isCurrentInstance ? (
                            <CurrentInstanceBadge className="shrink-0" />
                        ) : (
                            <InstanceVisitedBadge
                                location={location}
                                className="shrink-0"
                            />
                        )}
                    </div>
                    <InstanceActionBar
                        className="text-muted-foreground group-hover/row:text-foreground min-w-0 flex-wrap justify-start sm:justify-end"
                        target={{
                            location,
                            shortName: launchToken,
                            worldName: normalizeLocationText(
                                worldName ||
                                    instanceRecord.worldName ||
                                    instanceWorld.name
                            )
                        }}
                        instance={instance}
                        friendCount={
                            Number(instanceRecord.friendCount) || undefined
                        }
                        playerCount={playerCount}
                        capacity={capacity}
                        instanceInfoPlacement="start"
                        instanceCountAlign="right"
                        instanceSummaryOrder="markers-first"
                        showHistory={showHistory}
                        historyTooltip="Visit history"
                        onHistory={onShowHistory}
                    />
                </div>
                <div className="pl-6.5">
                    <InstanceUserTiles
                        instance={instance}
                        instanceLocation={location}
                        visibleUserIds={visibleInstanceUserIds}
                        showInstanceDuration
                    />
                </div>
            </div>
        );
    },
    (
        { instance: prevInstance, tags: prevTags, ...prev },
        { instance: nextInstance, tags: nextTags, ...next }
    ) =>
        shallow(prev, next) &&
        structuralEqual(prevInstance, nextInstance) &&
        structuralEqual(prevTags, nextTags)
);

export function WorldDialogInstancesPanel({
    world,
    rows,
    currentUserId,
    worldDialogShortName,
    visibleInstanceUserIds,
    isInstanceLocation,
    showHistory,
    refreshing,
    onShowHistory,
    onRefresh
}: {
    world: WorldProfileRecord;
    rows: WorldDialogInstanceRow[];
    currentUserId: string | null;
    worldDialogShortName: string;
    visibleInstanceUserIds: ReadonlySet<string>;
    isInstanceLocation: boolean;
    showHistory: boolean;
    refreshing: boolean;
    onShowHistory: () => void;
    onRefresh: () => void;
}) {
    const { t } = useTranslation();
    const [createOptions, setCreateOptions] =
        useState<InstanceCreateOptions | null>(null);
    const [filter, setFilter] = useState<WorldInstanceFilter>(
        EMPTY_WORLD_INSTANCE_FILTER
    );
    const { languageName } = useLanguageNames();
    const { onShowHistory: showInstanceHistory } = useStableCommands({
        onShowHistory
    });

    useEffect(() => {
        let cancelled = false;
        vrchatInstanceRepository
            .getInstanceCreateOptions()
            .then((options) => {
                if (!cancelled) {
                    setCreateOptions(options);
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const categoryById = new Map(
        (createOptions?.categories ?? []).map((option) => [option.id, option])
    );
    const vibeById = new Map(
        (createOptions?.vibes ?? []).map((option) => [option.id, option])
    );
    const optionLabel = (
        id: string,
        options: Map<string, InstanceCreateOption>,
        kind: 'category' | 'vibe'
    ) => {
        const option = options.get(id);
        if (!option) {
            return id;
        }
        return kind === 'category'
            ? option.name
            : instanceCreateOptionLabel(option, kind, t);
    };

    const filterOptions = worldInstanceFilterOptions(rows);
    const activeFilterCount = activeWorldInstanceFilterCount(filter);
    const hasMenuFilters = Boolean(
        activeFilterCount ||
        filterOptions.categoryIds.length ||
        filterOptions.vibeIds.length ||
        filterOptions.languages.length
    );
    const visibleRows = filterWorldInstanceRows(rows, filter, {
        isFriend: (userId) =>
            userId !== currentUserId && visibleInstanceUserIds.has(userId),
        worldCapacity: world.capacity
    });

    function patchFilter(patch: Partial<WorldInstanceFilter>) {
        setFilter((current) => ({ ...current, ...patch }));
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2">
                    <WorldInstanceQuickFilter
                        icon={UsersIcon}
                        label={t('dialog.world.instances.filter_with_friends')}
                        pressed={filter.withFriends}
                        onPressedChange={(withFriends) =>
                            patchFilter({ withFriends })
                        }
                    />
                    <WorldInstanceQuickFilter
                        icon={EyeOffIcon}
                        label={t(
                            'dialog.world.instances.filter_hide_unavailable'
                        )}
                        pressed={filter.hideUnavailable}
                        onPressedChange={(hideUnavailable) =>
                            patchFilter({ hideUnavailable })
                        }
                    />
                </div>
                {hasMenuFilters ? (
                    <ToolbarFilterMenu activeCount={activeFilterCount}>
                        {filterOptions.categoryIds.length ? (
                            <>
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>
                                        {t('dialog.new_instance.category')}
                                    </DropdownMenuLabel>
                                    <DropdownMenuRadioGroup
                                        value={filter.categoryId}
                                        onValueChange={(categoryId: string) =>
                                            patchFilter({ categoryId })
                                        }
                                    >
                                        <DropdownMenuRadioItem
                                            value=""
                                            onClick={(event) =>
                                                event.preventDefault()
                                            }
                                        >
                                            {t(
                                                'dialog.world.instances.filter_category_all'
                                            )}
                                        </DropdownMenuRadioItem>
                                        {filterOptions.categoryIds.map((id) => (
                                            <DropdownMenuRadioItem
                                                key={id}
                                                value={id}
                                                onClick={(event) =>
                                                    event.preventDefault()
                                                }
                                            >
                                                {optionLabel(
                                                    id,
                                                    categoryById,
                                                    'category'
                                                )}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                        {filterOptions.vibeIds.length ? (
                            <>
                                {filterOptions.categoryIds.length ? (
                                    <DropdownMenuSeparator />
                                ) : null}
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>
                                        {t('dialog.new_instance.vibes')}
                                    </DropdownMenuLabel>
                                    {filterOptions.vibeIds.map((id) => (
                                        <DropdownMenuCheckboxItem
                                            key={id}
                                            checked={filter.vibeIds.includes(
                                                id
                                            )}
                                            onClick={(event) =>
                                                event.preventDefault()
                                            }
                                            onCheckedChange={(checked) =>
                                                patchFilter({
                                                    vibeIds: toggle(
                                                        filter.vibeIds,
                                                        id,
                                                        checked
                                                    )
                                                })
                                            }
                                        >
                                            {optionLabel(id, vibeById, 'vibe')}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                        {filterOptions.languages.length ? (
                            <>
                                {filterOptions.categoryIds.length ||
                                filterOptions.vibeIds.length ? (
                                    <DropdownMenuSeparator />
                                ) : null}
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>
                                        {t('dialog.user.label.languages')}
                                    </DropdownMenuLabel>
                                    {filterOptions.languages.map((key) => (
                                        <DropdownMenuCheckboxItem
                                            key={key}
                                            checked={filter.languages.includes(
                                                key
                                            )}
                                            onClick={(event) =>
                                                event.preventDefault()
                                            }
                                            onCheckedChange={(checked) =>
                                                patchFilter({
                                                    languages: toggle(
                                                        filter.languages,
                                                        key,
                                                        checked
                                                    )
                                                })
                                            }
                                        >
                                            {languageName(key)}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                        {activeFilterCount ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={() =>
                                        patchFilter({
                                            categoryId: '',
                                            languages: [],
                                            vibeIds: []
                                        })
                                    }
                                >
                                    {t('dialog.world.instances.filter_clear')}
                                </DropdownMenuItem>
                            </>
                        ) : null}
                    </ToolbarFilterMenu>
                ) : null}
                <ToolbarRefreshButton
                    loading={refreshing}
                    onRefresh={onRefresh}
                />
                <WorldSidebarPinButton worldId={world.id} name={world.name} />
            </div>
            <div
                className={cn(
                    'flex shrink-0 flex-col',
                    visibleRows.length &&
                        'bg-card ring-stroke-subtle overflow-hidden rounded-xl ring-1'
                )}
            >
                {visibleRows.length ? (
                    visibleRows.map((instance) => {
                        const instanceRef = record(instance.ref);
                        const categoryId = normalizeLocationText(
                            instanceRef.categoryId
                        );
                        const tags = [
                            ...(categoryId
                                ? [
                                      optionLabel(
                                          categoryId,
                                          categoryById,
                                          'category'
                                      )
                                  ]
                                : []),
                            ...stringList(instanceRef.vibeIds).map((id) =>
                                optionLabel(id, vibeById, 'vibe')
                            )
                        ];
                        return (
                            <WorldInstanceRow
                                key={instance.id}
                                instance={instance}
                                tags={tags}
                                worldId={world.id}
                                worldName={world.name}
                                worldCapacity={world.capacity}
                                currentUserId={currentUserId}
                                worldDialogShortName={worldDialogShortName}
                                visibleInstanceUserIds={visibleInstanceUserIds}
                                showHistory={showHistory}
                                onShowHistory={showInstanceHistory}
                            />
                        );
                    })
                ) : rows.length ? (
                    <p className="text-muted-foreground py-6 text-center text-sm">
                        {t('dialog.world.instances.filter_no_match')}
                    </p>
                ) : !isInstanceLocation ? (
                    <WorldInstancesEmptyState />
                ) : null}
            </div>
        </>
    );
}
