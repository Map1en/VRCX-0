import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField.jsx';

export function SettingsAdvancedCacheCard({
    t,
    prefs,
    cacheStats,
    gameLogDisabledLabel,
    onClearVrcxCache,
    onPromptAutoClearVrcxCacheFrequency,
    onRefreshCacheSize,
    onGameLogDisabledChange
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    {t('view.settings.advanced.advanced.cache_debug.header')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
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
                                'view.settings.advanced.advanced.cache_debug.clear_cache'
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onPromptAutoClearVrcxCacheFrequency}
                        >
                            {t(
                                'view.settings.advanced.advanced.cache_debug.auto_clear_cache'
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onRefreshCacheSize}
                        >
                            {t(
                                'view.settings.advanced.advanced.cache_debug.refresh_cache'
                            )}
                        </Button>
                    </div>
                </Field>
                <div className="text-muted-foreground grid gap-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
                    {[
                        [
                            t(
                                'view.settings.advanced.advanced.cache_debug.user_cache'
                            ),
                            cacheStats.userCache
                        ],
                        [
                            t(
                                'view.settings.advanced.advanced.cache_debug.world_cache'
                            ),
                            cacheStats.worldCache
                        ],
                        [
                            t(
                                'view.settings.advanced.advanced.cache_debug.avatar_cache'
                            ),
                            cacheStats.avatarCache
                        ],
                        [
                            t(
                                'view.settings.advanced.advanced.cache_debug.group_cache'
                            ),
                            cacheStats.groupCache
                        ],
                        ['TanStack Query', cacheStats.queryCache],
                        [
                            t(
                                'view.settings.advanced.advanced.cache_debug.avatar_name_cache'
                            ),
                            cacheStats.avatarNameCache
                        ],
                        [
                            t(
                                'view.settings.advanced.advanced.cache_debug.instance_cache'
                            ),
                            cacheStats.instanceCache
                        ],
                        [
                            t('view.settings.generated.favorite_detail_cache'),
                            cacheStats.favoriteDetailsCache
                        ],
                        [
                            t(
                                'view.settings.generated.favorite_detail_pending'
                            ),
                            cacheStats.favoriteDetailsPending
                        ],
                        [
                            t('dialog.config_json.cache_size'),
                            cacheStats.assetBundleCacheSize || 'Not refreshed'
                        ]
                    ].map(([label, value]) => (
                        <div
                            key={label}
                            className="flex justify-between gap-3"
                        >
                            <span>{label}</span>
                            <span className="font-mono">{value}</span>
                        </div>
                    ))}
                </div>
                <Field label={gameLogDisabledLabel}>
                    <Switch
                        checked={prefs.gameLogDisabled}
                        onCheckedChange={onGameLogDisabledChange}
                    />
                </Field>
            </CardContent>
        </Card>
    );
}
