// @ts-nocheck
import { useEffect, useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { EntityList } from './UserDialogEntityList';

function favoriteGroupLimit(group) {
    const value =
        group?.capacity ??
        group?.maxFavorites ??
        group?.max_favorites ??
        group?.limit ??
        group?.max;
    const limit = Number(value);
    return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function favoriteGroupCountLabel(group) {
    const limit = favoriteGroupLimit(group);
    return limit ? `${group.rows.length}/${limit}` : String(group.rows.length);
}

export function FavoriteWorldGroups({
    groups,
    rows,
    search,
    filteredRows,
    loading,
    error
}) {
    const groupedRows = groups.length
        ? groups.map((group) => ({
              key: group.name,
              label: group.displayName || group.name,
              visibility: group.visibility || '',
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
                      const key = world.$favoriteGroup || 'Favorites';
                      if (!map.has(key)) {
                          map.set(key, {
                              key,
                              label: key,
                              visibility: '',
                              rows: []
                          });
                      }
                      map.get(key).rows.push(world);
                      return map;
                  }, new Map())
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

    if (search.trim()) {
        return (
            <EntityList
                rows={filteredRows}
                kind="world"
                loading={loading}
                error={error}
            />
        );
    }
    if (loading || error || !groupedRows.length) {
        return (
            <EntityList
                rows={rows}
                kind="world"
                loading={loading}
                error={error}
            />
        );
    }

    return (
        <Tabs
            value={activeGroup}
            onValueChange={setActiveGroup}
            className="gap-2"
        >
            <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
                {groupedRows.map((group) => (
                    <TabsTrigger
                        key={group.key}
                        value={group.key}
                        className="flex-none gap-1.5"
                    >
                        <span>{group.label}</span>
                        {group.visibility ? (
                            <span className="text-muted-foreground text-xs font-normal">
                                {group.visibility}
                            </span>
                        ) : null}
                        <span className="text-muted-foreground text-xs tabular-nums">
                            {favoriteGroupCountLabel(group)}
                        </span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {groupedRows.map((group) => (
                <TabsContent key={group.key} value={group.key} className="m-0">
                    <EntityList rows={group.rows} kind="world" />
                </TabsContent>
            ))}
        </Tabs>
    );
}
