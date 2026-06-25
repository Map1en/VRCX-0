import { DatabaseIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field, JsonTreeView, SettingsGroup } from '../SettingsField';
import { SettingsAdvancedCacheCard } from './SettingsAdvancedCacheCard';

export function SettingsAdvancedDataCards({
    prefs,
    cacheStats,
    cacheStatsVisible,
    avatarAutoCleanupOptions,
    sqliteTableSizes,
    sqliteTableSizeRows,
    onlineVisitCount,
    configTreeData,
    tauriAppSnapshot,
    onAutoSweepVRChatCacheChange,
    onClearVrcxCache,
    onPromptAutoClearVrcxCacheFrequency,
    onRefreshCacheSize,
    onAvatarAutoCleanupChange,
    onMigrateLegacyVrcxData,
    onRefreshSqliteTableSizes,
    onRefreshOnlineVisits,
    onRefreshConfigTreeData,
    onRefreshRuntimeAppSnapshot,
    onClearConfigTreeData
}: any) {
    const { t } = useTranslation();
    return (
        <>
            <SettingsGroup
                title={t(
                    'view.settings.advanced_groups.diagnostics_maintenance.header'
                )}
            >
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
                    cacheStats={cacheStats}
                    cacheStatsVisible={cacheStatsVisible}
                    autoSweepEnabled={prefs.autoSweepVRChatCache}
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
                                {avatarAutoCleanupOptions.map((value: any) => (
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
                        'view.settings.advanced_groups.diagnostics_maintenance.refresh'
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
                    <div className="text-muted-foreground grid [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))] gap-x-6 gap-y-1 rounded-lg border p-3 text-sm">
                        {sqliteTableSizeRows.map(([key, labelKey]: any) => (
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
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.advanced_groups.diagnostics.header')}
            >
                <Field label={t('view.profile.game_info.online_users')}>
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
                        'view.settings.advanced_groups.diagnostics.runtime_lifecycle'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onRefreshRuntimeAppSnapshot}
                    >
                        {t(
                            'view.settings.advanced_groups.diagnostics.refresh_runtime_lifecycle'
                        )}
                    </Button>
                </Field>
                {tauriAppSnapshot ? (
                    <div className="bg-muted/30 max-h-[32rem] overflow-auto rounded-lg border p-3">
                        <JsonTreeView data={tauriAppSnapshot} />
                    </div>
                ) : null}
            </SettingsGroup>
        </>
    );
}
import { useTranslation } from 'react-i18next';
