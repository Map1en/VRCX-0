// @ts-nocheck
import { Button } from '@/ui/shadcn/button';

import { Field } from '../SettingsField';

const CACHE_STAT_ROWS = [
    ['userCache', 'view.settings.advanced.advanced.cache_debug.user_cache'],
    ['worldCache', 'view.settings.advanced.advanced.cache_debug.world_cache'],
    ['avatarCache', 'view.settings.advanced.advanced.cache_debug.avatar_cache'],
    ['groupCache', 'view.settings.advanced.advanced.cache_debug.group_cache'],
    ['queryCache', null, 'TanStack Query'],
    [
        'avatarNameCache',
        'view.settings.advanced.advanced.cache_debug.avatar_name_cache'
    ],
    [
        'instanceCache',
        'view.settings.advanced.advanced.cache_debug.instance_cache'
    ],
    ['favoriteDetailsCache', 'view.settings.label.favorite_detail_cache'],
    ['favoriteDetailsPending', 'view.settings.loading.favorite_detail_pending'],
    ['assetBundleCacheSize', 'dialog.config_json.cache_size']
];

export function SettingsAdvancedCacheCard({
    t,
    cacheStats,
    cacheStatsVisible,
    onClearVrcxCache,
    onPromptAutoClearVrcxCacheFrequency,
    onRefreshCacheSize
}) {
    return (
        <>
            <Field
                label={t(
                    'view.settings.advanced.advanced.cache_debug.header'
                )}
            >
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onClearVrcxCache}
                    >
                        {t(
                            'view.settings.advanced_groups.diagnostics_maintenance.clear_vrcx_cache'
                        )}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onPromptAutoClearVrcxCacheFrequency}
                    >
                        {t(
                            'view.settings.advanced_groups.diagnostics_maintenance.configure_auto_clear'
                        )}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onRefreshCacheSize}
                    >
                        {t(
                            'view.settings.advanced_groups.diagnostics_maintenance.refresh_cache_size'
                        )}
                    </Button>
                </div>
            </Field>
            {cacheStatsVisible ? (
                <div className="text-muted-foreground grid gap-x-6 gap-y-1 rounded-lg border p-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
                    {CACHE_STAT_ROWS.map(([key, labelKey, fallbackLabel]) => {
                        const value =
                            key === 'assetBundleCacheSize'
                                ? cacheStats[key] ||
                                  t(
                                      'view.settings.advanced_groups.diagnostics_maintenance.not_refreshed'
                                  )
                                : cacheStats[key];

                        return (
                            <div
                                key={key}
                                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
                            >
                                <span>
                                    {labelKey ? t(labelKey) : fallbackLabel}
                                </span>
                                <span className="font-mono">{value}</span>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </>
    );
}
