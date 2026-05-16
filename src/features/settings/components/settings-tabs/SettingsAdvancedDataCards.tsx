// @ts-nocheck
import { DatabaseIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field, JsonTreeView } from '../SettingsField';
import { SettingsAdvancedCacheCard } from './SettingsAdvancedCacheCard';

export function SettingsAdvancedDataCards({
    t,
    prefs,
    cacheStats,
    cacheStatsVisible,
    avatarAutoCleanupOptions,
    sqliteTableSizes,
    sqliteTableSizeRows,
    onlineVisitCount,
    configTreeData,
    backendAppSnapshot,
    onAutoSweepVRChatCacheChange,
    onClearVrcxCache,
    onPromptAutoClearVrcxCacheFrequency,
    onRefreshCacheSize,
    onAvatarAutoCleanupChange,
    onOpenPurgeDialog,
    onMigrateLegacyVrcxData,
    onRefreshSqliteTableSizes,
    onRefreshOnlineVisits,
    onRefreshConfigTreeData,
    onRefreshBackendAppSnapshot,
    onClearConfigTreeData
}) {
    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t(
                            'view.settings.advanced_groups.diagnostics_maintenance.header'
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.auto_cache_management.header'
                        )}
                        description={t(
                            'view.settings.advanced.advanced.auto_cache_management.description'
                        )}
                    >
                        <Switch
                            checked={prefs.autoSweepVRChatCache}
                            onCheckedChange={onAutoSweepVRChatCacheChange}
                        />
                    </Field>

                    <SettingsAdvancedCacheCard
                        t={t}
                        cacheStats={cacheStats}
                        cacheStatsVisible={cacheStatsVisible}
                        onClearVrcxCache={onClearVrcxCache}
                        onPromptAutoClearVrcxCacheFrequency={
                            onPromptAutoClearVrcxCacheFrequency
                        }
                        onRefreshCacheSize={onRefreshCacheSize}
                    />

                    <Field
                        label={t(
                            'view.settings.advanced.advanced.database_cleanup.auto_cleanup'
                        )}
                        description={t(
                            'view.settings.advanced.advanced.database_cleanup.auto_cleanup_description'
                        )}
                        controlId="settings-avatar-auto-cleanup"
                    >
                        <Select
                            value={prefs.avatarAutoCleanup}
                            onValueChange={onAvatarAutoCleanupChange}
                        >
                            <SelectTrigger
                                id="settings-avatar-auto-cleanup"
                                className="w-36"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {avatarAutoCleanupOptions.map((value) => (
                                        <SelectItem key={value} value={value}>
                                            {value === 'Off'
                                                ? t(
                                                      'view.settings.advanced.advanced.database_cleanup.auto_cleanup_off'
                                                  )
                                                : t(
                                                      `view.settings.advanced.advanced.database_cleanup.auto_cleanup_${value}`
                                                  )}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.database_cleanup.purge_button'
                        )}
                        description={t(
                            'view.settings.advanced_groups.diagnostics_maintenance.purge_avatar_history_description'
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onOpenPurgeDialog}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t(
                                'view.settings.advanced_groups.diagnostics_maintenance.purge_avatar_history'
                            )}
                        </Button>
                    </Field>

                    <Field
                        label={t(
                            'view.settings.advanced.advanced.sqlite_table_size.refresh'
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onRefreshSqliteTableSizes}
                        >
                            {t(
                                'view.settings.advanced_groups.diagnostics_maintenance.refresh_sqlite_tables'
                            )}
                        </Button>
                    </Field>
                    <Field
                        label={t(
                            'view.settings.advanced.advanced.database_cleanup.legacy_migration'
                        )}
                        description={t(
                            'view.settings.advanced.advanced.database_cleanup.legacy_migration_description'
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onMigrateLegacyVrcxData}
                        >
                            <DatabaseIcon data-icon="inline-start" />
                            {t(
                                'view.settings.advanced_groups.diagnostics_maintenance.migrate_legacy_vrcx'
                            )}
                        </Button>
                    </Field>
                    {Object.keys(sqliteTableSizes).length ? (
                        <div className="text-muted-foreground grid gap-x-6 gap-y-1 rounded-lg border p-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
                            {sqliteTableSizeRows.map(([key, labelKey]) => (
                                <div
                                    key={key}
                                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
                                >
                                    <span>{t(labelKey)}</span>
                                    <span className="font-mono">
                                        {sqliteTableSizes[key]}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.advanced_groups.diagnostics.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t('view.profile.game_info.online_users')}
                    >
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {onlineVisitCount !== null ? (
                                <span className="text-muted-foreground text-sm">
                                    {t('view.profile.game_info.user_online', {
                                        count: onlineVisitCount
                                    })}
                                </span>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onRefreshOnlineVisits}
                            >
                                {t(
                                    'view.settings.advanced_groups.diagnostics.refresh_online_users'
                                )}
                            </Button>
                        </div>
                    </Field>
                    <Field label={t('view.profile.config_json')}>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onRefreshConfigTreeData}
                            >
                                {t(
                                    'view.settings.advanced_groups.diagnostics.refresh_config_json'
                                )}
                            </Button>
                            {Object.keys(configTreeData).length ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={onClearConfigTreeData}
                                >
                                    {t(
                                        'view.settings.advanced_groups.diagnostics.clear_config_json'
                                    )}
                                </Button>
                            ) : null}
                        </div>
                    </Field>
                    {Object.keys(configTreeData).length ? (
                        <div className="bg-muted/30 max-h-[32rem] overflow-auto rounded-lg border p-3">
                            <JsonTreeView data={configTreeData} />
                        </div>
                    ) : null}
                    <Field
                        label={t(
                            'view.settings.advanced_groups.diagnostics.backend_runtime'
                        )}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onRefreshBackendAppSnapshot}
                        >
                            {t(
                                'view.settings.advanced_groups.diagnostics.refresh_backend_runtime'
                            )}
                        </Button>
                    </Field>
                    {backendAppSnapshot ? (
                        <div className="bg-muted/30 max-h-[32rem] overflow-auto rounded-lg border p-3">
                            <JsonTreeView data={backendAppSnapshot} />
                        </div>
                    ) : null}
                </CardContent>
            </Card>
        </>
    );
}
