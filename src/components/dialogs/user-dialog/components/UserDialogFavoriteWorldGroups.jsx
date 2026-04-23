import { useEffect, useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { EntityList } from './UserDialogEntityList.jsx';

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
              rows: rows.filter(
                  (world) =>
                      world.$favoriteGroupKey === group.name ||
                      world.$favoriteGroup === (group.displayName || group.name)
              )
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
            <TabsList
                variant="line"
                className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1"
            >
                {groupedRows.map((group) => (
                    <TabsTrigger
                        key={group.key}
                        value={group.key}
                        className="flex-none rounded-none px-3"
                    >
                        <span>{group.label}</span>
                        <span className="text-muted-foreground ml-1.5 text-xs">
                            {group.rows.length}
                        </span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {groupedRows.map((group) => (
                <TabsContent key={group.key} value={group.key} className="m-0">
                    {group.visibility ? (
                        <div className="text-muted-foreground px-1 py-1 text-xs">
                            {group.visibility}
                        </div>
                    ) : null}
                    <EntityList rows={group.rows} kind="world" />
                </TabsContent>
            ))}
        </Tabs>
    );
}
