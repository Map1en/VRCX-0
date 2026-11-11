import { UserIcon, UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CurrentInstanceBadge } from '@/components/instances/CurrentInstanceBadge';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { InstanceVisitedBadge } from '@/components/instances/InstanceVisitedBadge';
import { ToolbarFilterMenu } from '@/components/layout/ToolbarControls';
import { normalizeLocationText } from '@/components/location/locationModel';
import type { WorldProfileRecord } from '@/domain/entities/world';
import { cn } from '@/lib/utils';
import type {
    InstanceCreateOption,
    InstanceCreateOptions
} from '@/platform/tauri/bindings';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { isRecord } from '@/shared/utils/record';
import { languageOptionLabel } from '@/shared/utils/userLanguage';
import {
    DropdownMenuCheckboxItem,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator
} from '@/ui/shadcn/dropdown-menu';

import { useSpokenLanguageSelection } from '../useSpokenLanguageSelection';
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

const NO_LANGUAGE_KEYS: string[] = [];

function record(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function toggle(values: string[], value: string, checked: boolean) {
    return checked
        ? [...values.filter((item) => item !== value), value]
        : values.filter((item) => item !== value);
}

export function WorldDialogInstancesPanel({
    world,
    rows,
    currentUserId,
    worldDialogShortName,
    visibleInstanceUserIds,
    isInstanceLocation,
    showHistory,
    onShowHistory
}: {
    world: WorldProfileRecord;
    rows: WorldDialogInstanceRow[];
    currentUserId: string | null;
    worldDialogShortName: string;
    visibleInstanceUserIds: ReadonlySet<string>;
    isInstanceLocation: boolean;
    showHistory: boolean;
    onShowHistory: () => void;
}) {
    const { t } = useTranslation();
    const [createOptions, setCreateOptions] =
        useState<InstanceCreateOptions | null>(null);
    const [filter, setFilter] = useState<WorldInstanceFilter>(
        EMPTY_WORLD_INSTANCE_FILTER
    );
    const { languageOptionsMap } = useSpokenLanguageSelection(NO_LANGUAGE_KEYS);

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
    const languageLabel = (key: string) => {
        const option = languageOptionsMap.get(key);
        return option ? languageOptionLabel(option) : key.toUpperCase();
    };

    const filterOptions = worldInstanceFilterOptions(rows);
    const activeFilterCount = activeWorldInstanceFilterCount(filter);
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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="text-muted-foreground flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1">
                        <UserIcon className="size-3.5" />
                        {t('dialog.world.instances.public_count', {
                            count: world.publicOccupants ?? 0
                        })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <UserIcon className="size-3.5" />
                        {t('dialog.world.instances.private_count', {
                            count: world.privateOccupants ?? 0
                        })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <UsersIcon className="size-3.5" />
                        {t('dialog.world.instances.capacity_count', {
                            count: world.recommendedCapacity || '—',
                            max: world.capacity || '—'
                        })}
                    </span>
                </div>
                <ToolbarFilterMenu activeCount={activeFilterCount}>
                    <DropdownMenuGroup>
                        <DropdownMenuCheckboxItem
                            checked={filter.withFriends}
                            onClick={(event) => event.preventDefault()}
                            onCheckedChange={(checked) =>
                                patchFilter({ withFriends: checked })
                            }
                        >
                            {t('dialog.world.instances.filter_with_friends')}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={filter.hideUnavailable}
                            onClick={(event) => event.preventDefault()}
                            onCheckedChange={(checked) =>
                                patchFilter({ hideUnavailable: checked })
                            }
                        >
                            {t(
                                'dialog.world.instances.filter_hide_unavailable'
                            )}
                        </DropdownMenuCheckboxItem>
                    </DropdownMenuGroup>
                    {filterOptions.categoryIds.length ? (
                        <>
                            <DropdownMenuSeparator />
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
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>
                                    {t('dialog.new_instance.vibes')}
                                </DropdownMenuLabel>
                                {filterOptions.vibeIds.map((id) => (
                                    <DropdownMenuCheckboxItem
                                        key={id}
                                        checked={filter.vibeIds.includes(id)}
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
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>
                                    {t('dialog.user.label.languages')}
                                </DropdownMenuLabel>
                                {filterOptions.languages.map((key) => (
                                    <DropdownMenuCheckboxItem
                                        key={key}
                                        checked={filter.languages.includes(key)}
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
                                        {languageLabel(key)}
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
                                    setFilter(EMPTY_WORLD_INSTANCE_FILTER)
                                }
                            >
                                {t('dialog.world.instances.filter_clear')}
                            </DropdownMenuItem>
                        </>
                    ) : null}
                </ToolbarFilterMenu>
                <WorldSidebarPinButton worldId={world.id} name={world.name} />
            </div>
            <div
                className={cn(
                    'flex flex-col',
                    visibleRows.length &&
                        'bg-card ring-stroke-subtle overflow-hidden rounded-xl ring-1'
                )}
            >
                {visibleRows.length ? (
                    visibleRows.map((instance) => {
                        const instanceRecord = record(instance);
                        const instanceRef = record(instance.ref);
                        const instanceGroup = record(instance.group);
                        const instanceWorld = record(instanceRecord.world);
                        const location = resolveLaunchLocation(world, instance);
                        const shortName = normalizeLocationText(
                            instance.shortName
                        );
                        const launchToken =
                            shortName ||
                            normalizeLocationText(instance.secureName);
                        const { playerCount, capacity } =
                            worldInstanceOccupancy(instance, world.capacity);
                        const isClosed = Boolean(
                            instanceRef.closedAt || instanceRecord.closedAt
                        );
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
                            <div
                                key={instance.id}
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
                                                    normalizeLocationText(
                                                        instanceGroup.name
                                                    ),
                                                playerCount,
                                                capacity,
                                                showWorldName: false,
                                                showPlayerSummary: false,
                                                hint:
                                                    world.name ||
                                                    normalizeLocationText(
                                                        instanceRecord.worldName
                                                    ) ||
                                                    normalizeLocationText(
                                                        instanceWorld.name
                                                    )
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
                                                world.name ||
                                                    instanceRecord.worldName ||
                                                    instanceWorld.name
                                            )
                                        }}
                                        instance={instance}
                                        friendCount={
                                            Number(
                                                instanceRecord.friendCount
                                            ) || undefined
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
                                <InstanceUserTiles
                                    instance={instance}
                                    instanceLocation={location}
                                    visibleUserIds={visibleInstanceUserIds}
                                    showInstanceDuration
                                />
                            </div>
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
