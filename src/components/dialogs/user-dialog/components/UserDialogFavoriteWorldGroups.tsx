import { LockIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import type { EntityRecord } from '@/domain/entities/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { EntityList } from './UserDialogEntityList';

interface FavoriteWorldGroupView {
    capacity?: number;
    maxFavorites?: number;
    max_favorites?: number;
    limit?: number;
    max?: number;
    key: string;
    label: string;
    visibility: string;
    rows: EntityRecord[];
}

function favoriteGroupLimit(group: FavoriteWorldGroupView) {
    const value =
        group?.capacity ??
        group?.maxFavorites ??
        group?.max_favorites ??
        group?.limit ??
        group?.max;
    const limit = Number(value);
    return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function favoriteGroupCountLabel(group: FavoriteWorldGroupView) {
    const limit = favoriteGroupLimit(group);
    return limit ? `${group.rows.length}/${limit}` : String(group.rows.length);
}

export function FavoriteWorldGroups({
    groups,
    rows,
    search,
    filteredRows,
    loading,
    error,
    renderToolbar
}: {
    groups: readonly EntityRecord[];
    rows: readonly EntityRecord[];
    search: string;
    filteredRows: readonly EntityRecord[];
    loading: boolean;
    error: string;
    renderToolbar: (groupTabs: ReactNode) => ReactNode;
}) {
    const groupedRows = groups.length
        ? groups.map((group): FavoriteWorldGroupView & EntityRecord => ({
              ...group,
              key: String(group.name || ''),
              label: String(group.displayName || group.name || ''),
              visibility: String(group.visibility || ''),
              rows: rows.filter((world) => {
                  const groupLabel = group.displayName || group.name;
                  return (
                      world.$favoriteGroupKey === group.name ||
                      world.$favoriteGroup === groupLabel
                  );
              })
          }))
        : Array.from(
              rows
                  .reduce((map, world) => {
                      const key = String(world.$favoriteGroup || 'Favorites');
                      if (!map.has(key)) {
                          map.set(key, {
                              key,
                              label: key,
                              visibility: '',
                              rows: []
                          });
                      }
                      const group = map.get(key);
                      if (group) {
                          group.rows.push(world);
                      }
                      return map;
                  }, new Map<string, FavoriteWorldGroupView>())
                  .values()
          );
    const [activeGroup, setActiveGroup] = useState(groupedRows[0]?.key || '');

    useEffect(() => {
        if (
            groupedRows.length &&
            !groupedRows.some((group) => group.key === activeGroup)
        ) {
            setActiveGroup(groupedRows[0].key);
        }
    }, [activeGroup, groupedRows]);

    const showGroups =
        !search.trim() && !loading && !error && groupedRows.length > 0;

    return (
        <Tabs
            value={activeGroup}
            onValueChange={setActiveGroup}
            className="gap-2"
        >
            {renderToolbar(
                showGroups ? (
                    <TabsList className="max-w-full shrink justify-start overflow-x-auto overflow-y-hidden">
                        {groupedRows.map((group) => (
                            <TabsTrigger
                                key={group.key}
                                value={group.key}
                                className="flex-none gap-1.5"
                            >
                                {group.visibility &&
                                group.visibility !== 'public' ? (
                                    <LockIcon
                                        data-icon="inline-start"
                                        aria-hidden="true"
                                    />
                                ) : null}
                                <span>{group.label}</span>
                                <span className="text-content-tertiary text-[11px] leading-none font-medium tabular-nums">
                                    {favoriteGroupCountLabel(group)}
                                </span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                ) : null
            )}
            {showGroups ? (
                groupedRows.map((group) => (
                    <TabsContent
                        key={group.key}
                        value={group.key}
                        className="m-0"
                    >
                        <EntityList rows={group.rows} kind="world" />
                    </TabsContent>
                ))
            ) : (
                <EntityList
                    rows={search.trim() ? filteredRows : rows}
                    kind="world"
                    loading={loading}
                    error={error}
                />
            )}
        </Tabs>
    );
}
