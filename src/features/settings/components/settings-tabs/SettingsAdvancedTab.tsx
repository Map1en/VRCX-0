import {
    FolderOpenIcon,
    RefreshCwIcon,
    RotateCcwIcon,
    Trash2Icon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsAdvancedDataCards } from './SettingsAdvancedDataCards';

type AppDataDirState = {
    cliOverride?: boolean;
    currentDir?: string | null;
    defaultDir?: string | null;
    persistedDir?: string | null;
    source?: string;
};

type SettingsAdvancedPrefs = Record<string, unknown> & {
    anonymousUsageTelemetry?: boolean;
    defaultLaunchMode?: string;
    gameLogDisabled?: boolean;
    logResourceLoad?: boolean;
    relaunchVRChatAfterCrash?: boolean;
    showConfirmationOnSwitchAvatar?: boolean;
    udonExceptionLogging?: boolean;
    vrcQuitFix?: boolean;
};

type SettingsAdvancedTabProps = {
    advanced: Record<string, unknown> & {
        appDataDirState?: AppDataDirState | null;
        avatarAutoCleanupOptions: string[];
        cacheStats: unknown;
        cacheStatsVisible: boolean;
        configTreeData: unknown;
        gameLogDisabledLabel: string;
        onAnonymousUsageTelemetryChange: (checked: boolean) => unknown;
        onAutoSweepVRChatCacheChange: (checked: boolean) => unknown;
        onAvatarAutoCleanupChange: (value: string) => unknown;
        onClearConfigTreeData: () => unknown;
        onClearVrcxCache: () => unknown;
        onDefaultLaunchModeChange: (value: string) => unknown;
        onGameLogDisabledChange: (checked: boolean) => unknown;
        onLogResourceLoadChange: (checked: boolean) => unknown;
        onMigrateLegacyVrcxData: () => unknown;
        onOpenAppDataDirSelector: () => unknown;
        onOpenPurgeDialog: () => unknown;
        onPromptAutoClearVrcxCacheFrequency: () => unknown;
        onRefreshCacheSize: () => unknown;
        onRefreshConfigTreeData: () => unknown;
        onRefreshOnlineVisits: () => unknown;
        onRefreshRuntimeAppSnapshot: () => unknown;
        onRefreshSqliteTableSizes: () => unknown;
        onRelaunchVRChatAfterCrashChange: (checked: boolean) => unknown;
        onResetAppDataDir: () => unknown;
        onRestartForAppDataDir: () => unknown;
        onShowConfirmationOnSwitchAvatarChange: (checked: boolean) => unknown;
        onUdonExceptionLoggingChange: (checked: boolean) => unknown;
        onVrcQuitFixChange: (checked: boolean) => unknown;
        onlineVisitCount: unknown;
        prefs: SettingsAdvancedPrefs;
        sqliteTableSizeRows: ReadonlyArray<readonly [string, string]>;
        sqliteTableSizes: unknown;
        tauriAppSnapshot: unknown;
    };
};

const launchModeOptions = [
    [
        'vr',
        'view.settings.advanced.advanced.launch_commands.default_launch_mode_vr'
    ],
    [
        'desktop',
        'view.settings.advanced.advanced.launch_commands.default_launch_mode_desktop'
    ]
] as const;

function DataDirectoryPath({ value }: { value?: string | null }) {
    return (
        <div className="bg-muted/40 text-muted-foreground w-full min-w-0 rounded-md border px-2 py-1 font-mono text-xs break-all">
            {value || '-'}
        </div>
    );
}

export function SettingsAdvancedTab({ advanced }: SettingsAdvancedTabProps) {
    const {
        prefs,
        cacheStats,
        cacheStatsVisible,
        avatarAutoCleanupOptions,
        sqliteTableSizes,
        sqliteTableSizeRows,
        onlineVisitCount,
        configTreeData,
        appDataDirState,
        tauriAppSnapshot,
        gameLogDisabledLabel,
        onRelaunchVRChatAfterCrashChange,
        onVrcQuitFixChange,
        onAutoSweepVRChatCacheChange,
        onUdonExceptionLoggingChange,
        onLogResourceLoadChange,
        onDefaultLaunchModeChange,
        onShowConfirmationOnSwitchAvatarChange,
        onClearVrcxCache,
        onPromptAutoClearVrcxCacheFrequency,
        onRefreshCacheSize,
        onGameLogDisabledChange,
        onAvatarAutoCleanupChange,
        onOpenPurgeDialog,
        onMigrateLegacyVrcxData,
        onRefreshSqliteTableSizes,
        onRefreshOnlineVisits,
        onRefreshConfigTreeData,
        onRefreshRuntimeAppSnapshot,
        onOpenAppDataDirSelector,
        onResetAppDataDir,
        onRestartForAppDataDir,
        onClearConfigTreeData,
        onAnonymousUsageTelemetryChange
    } = advanced;
    const { t } = useTranslation();
    const gameLogDisabledDescription = t(
        'view.settings.advanced.advanced.cache_debug.disable_gamelog_notice'
    );
    const appDataDirSourceLabel = appDataDirState
        ? t(
              `view.settings.advanced.advanced.data_directory.source_${appDataDirState.source}`
          )
        : t('common.loading');
    const appDataDirActionsDisabled = Boolean(appDataDirState?.cliOverride);

    return (
        <SettingsTabContent value="advanced">
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.vrchat_settings.header'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.relaunch_vrchat.header'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.relaunch_vrchat.description'
                    )}
                >
                    <Switch
                        checked={prefs.relaunchVRChatAfterCrash}
                        onCheckedChange={onRelaunchVRChatAfterCrashChange}
                    />
                </Field>

                <Field
                    label={t(
                        'view.settings.advanced.advanced.vrchat_quit_fix.header'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.vrchat_quit_fix.description'
                    )}
                >
                    <Switch
                        checked={prefs.vrcQuitFix}
                        onCheckedChange={onVrcQuitFixChange}
                    />
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.data_directory.header'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.data_directory.current'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.data_directory.description',
                        {
                            source: appDataDirSourceLabel
                        }
                    )}
                    controlClassName="lg:max-w-[34rem]"
                >
                    <DataDirectoryPath value={appDataDirState?.currentDir} />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.data_directory.default'
                    )}
                    controlClassName="lg:max-w-[34rem]"
                >
                    <DataDirectoryPath value={appDataDirState?.defaultDir} />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.data_directory.persisted'
                    )}
                    description={
                        appDataDirState?.cliOverride
                            ? t(
                                  'view.settings.advanced.advanced.data_directory.cli_override'
                              )
                            : undefined
                    }
                    controlClassName="lg:max-w-[34rem]"
                >
                    <DataDirectoryPath
                        value={
                            appDataDirState?.persistedDir ||
                            t(
                                'view.settings.advanced.advanced.data_directory.not_set'
                            )
                        }
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.data_directory.actions'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.data_directory.restart_hint'
                    )}
                    controlClassName="flex-wrap gap-2"
                >
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={appDataDirActionsDisabled}
                            onClick={onOpenAppDataDirSelector}
                        >
                            <FolderOpenIcon className="size-4" />
                            {t(
                                'view.settings.advanced.advanced.data_directory.choose'
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={appDataDirActionsDisabled}
                            onClick={onResetAppDataDir}
                        >
                            <RotateCcwIcon className="size-4" />
                            {t(
                                'view.settings.advanced.advanced.data_directory.reset'
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onRestartForAppDataDir}
                        >
                            <RefreshCwIcon className="size-4" />
                            {t(
                                'view.settings.advanced.advanced.data_directory.restart'
                            )}
                        </Button>
                    </div>
                </Field>
            </SettingsGroup>
            <SettingsGroup title={t('view.settings.general.logging.header')}>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.cache_debug.udon_exception_logging'
                    )}
                >
                    <Switch
                        checked={prefs.udonExceptionLogging}
                        onCheckedChange={onUdonExceptionLoggingChange}
                    />
                </Field>
                <Field label={t('view.settings.general.logging.resource_load')}>
                    <Switch
                        checked={prefs.logResourceLoad}
                        onCheckedChange={onLogResourceLoadChange}
                    />
                </Field>
                <Field
                    label={gameLogDisabledLabel}
                    description={gameLogDisabledDescription}
                >
                    <Switch
                        checked={prefs.gameLogDisabled}
                        onCheckedChange={onGameLogDisabledChange}
                    />
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced.launch_commands.header'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.launch_commands.default_launch_mode'
                    )}
                >
                    <Select
                        value={prefs.defaultLaunchMode}
                        items={launchModeOptions.map(([value, labelKey]) => ({
                            value,
                            label: t(labelKey)
                        }))}
                        onValueChange={(value) =>
                            onDefaultLaunchModeChange(value ?? '')
                        }
                    >
                        <SelectTrigger className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {launchModeOptions.map(([value, labelKey]) => (
                                    <SelectItem key={value} value={value}>
                                        {t(labelKey)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced.launch_commands.show_confirmation_on_switch_avatar_enable'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.launch_commands.show_confirmation_on_switch_avatar_tooltip'
                    )}
                >
                    <Switch
                        checked={prefs.showConfirmationOnSwitchAvatar}
                        onCheckedChange={onShowConfirmationOnSwitchAvatarChange}
                    />
                </Field>
            </SettingsGroup>
            <SettingsAdvancedDataCards
                prefs={prefs}
                cacheStats={cacheStats}
                cacheStatsVisible={cacheStatsVisible}
                avatarAutoCleanupOptions={avatarAutoCleanupOptions}
                sqliteTableSizes={sqliteTableSizes}
                sqliteTableSizeRows={sqliteTableSizeRows}
                onlineVisitCount={onlineVisitCount}
                configTreeData={configTreeData}
                tauriAppSnapshot={tauriAppSnapshot}
                onAutoSweepVRChatCacheChange={onAutoSweepVRChatCacheChange}
                onClearVrcxCache={onClearVrcxCache}
                onPromptAutoClearVrcxCacheFrequency={
                    onPromptAutoClearVrcxCacheFrequency
                }
                onRefreshCacheSize={onRefreshCacheSize}
                onAvatarAutoCleanupChange={onAvatarAutoCleanupChange}
                onMigrateLegacyVrcxData={onMigrateLegacyVrcxData}
                onRefreshSqliteTableSizes={onRefreshSqliteTableSizes}
                onRefreshOnlineVisits={onRefreshOnlineVisits}
                onRefreshConfigTreeData={onRefreshConfigTreeData}
                onRefreshRuntimeAppSnapshot={onRefreshRuntimeAppSnapshot}
                onClearConfigTreeData={onClearConfigTreeData}
            />
            <SettingsGroup
                title={t('view.settings.advanced.advanced.improvement.header')}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced.anonymous_usage_telemetry.header'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.anonymous_usage_telemetry.description'
                    )}
                >
                    <Switch
                        checked={prefs.anonymousUsageTelemetry}
                        onCheckedChange={onAnonymousUsageTelemetryChange}
                    />
                </Field>
            </SettingsGroup>
            {/* Danger zone: destructive, irreversible actions kept visually separate at the bottom. */}
            <section className="border-destructive/30 flex shrink-0 flex-col rounded-lg border">
                <div className="px-4 pt-4 pb-1">
                    <h3 className="text-destructive font-heading text-base leading-snug font-medium">
                        {t('view.settings.advanced_groups.danger.header')}
                    </h3>
                </div>
                <div className="flex flex-col px-4 pb-2">
                    <Field
                        label={t(
                            'view.settings.advanced_groups.diagnostics_maintenance.purge_avatar_history'
                        )}
                        description={t(
                            'view.settings.advanced_groups.danger.cannot_be_undone'
                        )}
                    >
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={onOpenPurgeDialog}
                        >
                            <Trash2Icon data-icon="inline-start" />
                            {t(
                                'view.settings.advanced_groups.diagnostics_maintenance.purge_avatar_history'
                            )}
                        </Button>
                    </Field>
                </div>
            </section>
        </SettingsTabContent>
    );
}
