import { GlobeIcon, RefreshCwIcon, ShuffleIcon } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/layout/PageScaffold';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import { TabsContent } from '@/ui/shadcn/tabs';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import {
    aggregateHotWorlds,
    loadHotInstances,
    type SearchHotMode,
    type SearchHotWorld
} from '../searchHotWorlds';
import { HotWorldCard, SearchLoadingState } from './SearchResultParts';

export function SearchHotTabPanel({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<SearchHotMode>('active');
    const [results, setResults] = useState<
        Partial<Record<SearchHotMode, SearchHotWorld[]>>
    >({});
    const [loadingModes, setLoadingModes] = useState<
        Partial<Record<SearchHotMode, boolean>>
    >({});
    const worlds = results[mode] ?? [];
    const loading = loadingModes[mode] === true;

    async function loadWorlds(nextMode: SearchHotMode) {
        setLoadingModes((current) => ({ ...current, [nextMode]: true }));
        try {
            const instances = await loadHotInstances(nextMode);
            setResults((current) => ({
                ...current,
                [nextMode]: aggregateHotWorlds(instances)
            }));
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('view.search.toast.failed_to_load_hot_worlds')
                )
            });
        } finally {
            setLoadingModes((current) => ({ ...current, [nextMode]: false }));
        }
    }

    const loadVisibleWorlds = useEffectEvent(() => {
        if (!results[mode] && !loadingModes[mode]) {
            loadWorlds(mode);
        }
    });

    useEffect(() => {
        if (active) {
            loadVisibleWorlds();
        }
    }, [active, mode]);

    return (
        <TabsContent
            value="hot"
            keepMounted
            className="relative m-0 flex min-h-0 flex-1 flex-col data-hidden:hidden"
        >
            <div className="flex flex-wrap items-center gap-3 px-1 pb-3">
                <ToggleGroup
                    variant="outline"
                    size="sm"
                    value={[mode]}
                    onValueChange={(nextValue) => {
                        if (
                            nextValue[0] === 'active' ||
                            nextValue[0] === 'discover'
                        ) {
                            setMode(nextValue[0]);
                        }
                    }}
                >
                    <ToggleGroupItem value="active">
                        {t('view.search.hot.active')}
                    </ToggleGroupItem>
                    <ToggleGroupSeparator />
                    <ToggleGroupItem value="discover">
                        {t('view.search.hot.discover')}
                    </ToggleGroupItem>
                </ToggleGroup>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ms-auto"
                    disabled={loading}
                    onClick={() => {
                        loadWorlds(mode);
                    }}
                >
                    {mode === 'discover' ? (
                        <ShuffleIcon data-icon="inline-start" />
                    ) : (
                        <RefreshCwIcon data-icon="inline-start" />
                    )}
                    {mode === 'discover'
                        ? t('view.search.hot.shuffle')
                        : t('common.actions.refresh')}
                </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
                {loading ? (
                    <SearchLoadingState />
                ) : worlds.length > 0 ? (
                    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))] gap-4">
                        {worlds.map((entry) => (
                            <HotWorldCard key={entry.world.id} entry={entry} />
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        variant="panel"
                        icon={GlobeIcon}
                        title={t('view.search.hot.empty')}
                    />
                )}
            </div>
        </TabsContent>
    );
}
