import { FolderOpenIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { AdvancedTroubleshootingGroup } from './AdvancedTroubleshootingGroup';
import type { SettingsAdvancedModel } from './settingsAdvancedTypes';

type SettingsAdvancedTabProps = {
    advanced: SettingsAdvancedModel;
};

type DataDirectoryPathProps = {
    value?: string | null;
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

function DataDirectoryPath({ value }: DataDirectoryPathProps) {
    return (
        <div className="bg-muted/40 text-muted-foreground w-full min-w-0 rounded-md border px-2 py-1 font-mono text-xs break-all">
            {value || '-'}
        </div>
    );
}

function DeepLinkRegistrationField() {
    const { t } = useTranslation();
    const [registered, setRegistered] = useState<boolean | null>();
    const [repairing, setRepairing] = useState(false);

    useEffect(() => {
        let active = true;

        commands
            .appDeepLinkRegistrationStatus()
            .then((status) => {
                if (active) {
                    setRegistered(status);
                }
            })
            .catch(() => {
                if (active) {
                    setRegistered(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    if (registered === undefined || registered === null) {
        return null;
    }

    async function repairRegistration() {
        setRepairing(true);
        try {
            const status = await commands.appDeepLinkRegistrationRepair();
            setRegistered(status);
            if (status) {
                toast.success(
                    t(
                        'view.settings.advanced.advanced_ui.behavior.deep_link_repair_success'
                    )
                );
            } else {
                toast.error(
                    t(
                        'view.settings.advanced.advanced_ui.behavior.deep_link_repair_failed'
                    )
                );
            }
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setRepairing(false);
        }
    }

    return (
        <Field
            label={t(
                'view.settings.advanced.advanced_ui.behavior.deep_link_registration'
            )}
            description={t(
                registered
                    ? 'view.settings.advanced.advanced_ui.behavior.deep_link_registered'
                    : 'view.settings.advanced.advanced_ui.behavior.deep_link_not_registered'
            )}
        >
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={repairing}
                onClick={() => void repairRegistration()}
            >
                {t(
                    'view.settings.advanced.advanced_ui.behavior.deep_link_repair'
                )}
            </Button>
        </Field>
    );
}

export function SettingsAdvancedTab({ advanced }: SettingsAdvancedTabProps) {
    const {
        prefs,
        avatarAutoCleanupOptions,
        sqliteTableSizes,
        sqliteTableSizeRows,
        onlineVisitCount,
        configTreeData,
        appDataDirState,
        onRelaunchVRChatAfterCrashChange,
        onVrcQuitFixChange,
        onAutoSweepVRChatCacheChange,
        onUdonExceptionLoggingChange,
        onLogResourceLoadChange,
        onDefaultLaunchModeChange,
        onGameLogDisabledChange,
        onAvatarAutoCleanupChange,
        onOpenPurgeDialog,
        onMigrateLegacyVrcxData,
        onRefreshSqliteTableSizes,
        onRefreshOnlineVisits,
        onRefreshConfigTreeData,
        onOpenAppDataDirSelector,
        onResetAppDataDir,
        onCleanupAppDataDir,
        onDismissAppDataDirCleanup,
        onClearConfigTreeData,
        onAnonymousUsageTelemetryChange
    } = advanced;
    const { t } = useTranslation();
    const appDataDirSourceLabel = appDataDirState
        ? t(
              `view.settings.advanced.advanced.data_directory.source_${appDataDirState.source}`
          )
        : t('common.loading');
    const appDataDirActionsDisabled = Boolean(
        appDataDirState?.cliOverride || appDataDirState?.pendingMigration
    );

    return (
        <SettingsTabContent value="advanced">
            <SettingsGroup
                title={t('view.settings.advanced.advanced_ui.behavior.header')}
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
                        'view.settings.advanced.advanced_ui.behavior.quit_header'
                    )}
                    description={t(
                        'view.settings.advanced.advanced_ui.behavior.quit_description'
                    )}
                >
                    <Switch
                        checked={prefs.vrcQuitFix}
                        onCheckedChange={onVrcQuitFixChange}
                    />
                </Field>
                <DeepLinkRegistrationField />
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
            </SettingsGroup>

            <SettingsGroup
                title={t('view.settings.advanced.advanced_ui.storage.header')}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced_ui.storage.data_location'
                    )}
                    description={t(
                        'view.settings.advanced.advanced.data_directory.description',
                        { source: appDataDirSourceLabel }
                    )}
                    className="lg:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]"
                >
                    <div className="flex w-full flex-col items-end gap-2">
                        <DataDirectoryPath
                            value={appDataDirState?.currentDir}
                        />
                        <div className="flex items-center justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={appDataDirActionsDisabled}
                                onClick={onOpenAppDataDirSelector}
                            >
                                <FolderOpenIcon data-icon="inline-start" />
                                {t(
                                    'view.settings.advanced.advanced_ui.storage.change_folder'
                                )}
                            </Button>
                            {appDataDirState?.persistedDir &&
                            !appDataDirActionsDisabled ? (
                                <DropdownMenu>
                                    <Tooltip>
                                        <TooltipTrigger
                                            render={
                                                <DropdownMenuTrigger
                                                    render={
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="icon-sm"
                                                            aria-label={t(
                                                                'view.settings.advanced.advanced_ui.storage.more'
                                                            )}
                                                        >
                                                            <MoreHorizontalIcon data-icon="inline-start" />
                                                        </Button>
                                                    }
                                                />
                                            }
                                        />
                                        <TooltipContent>
                                            {t(
                                                'view.settings.advanced.advanced_ui.storage.more'
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuGroup>
                                            <DropdownMenuItem
                                                onClick={onResetAppDataDir}
                                            >
                                                {t(
                                                    'view.settings.advanced.advanced_ui.storage.restore_default'
                                                )}
                                            </DropdownMenuItem>
                                        </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : null}
                        </div>
                    </div>
                </Field>
                {appDataDirState?.cliOverride ? (
                    <Alert className="pr-32">
                        <AlertTitle>
                            {t(
                                'view.settings.advanced.advanced.data_directory.source_cli'
                            )}
                        </AlertTitle>
                        <AlertDescription>
                            {t(
                                'view.settings.advanced.advanced.data_directory.cli_override'
                            )}
                        </AlertDescription>
                    </Alert>
                ) : null}
                {appDataDirState?.pendingMigration &&
                !appDataDirState.cliOverride ? (
                    <Alert>
                        <AlertTitle>
                            {t('data_dir_migration.completed_title')}
                        </AlertTitle>
                        <AlertDescription>
                            {t('data_dir_migration.completed_description')}
                        </AlertDescription>
                    </Alert>
                ) : null}
                {appDataDirState?.cleanupPending ? (
                    <Alert>
                        <AlertTitle>
                            {t('data_dir_migration.cleanup.settings_title')}
                        </AlertTitle>
                        <AlertDescription className="space-y-3">
                            <p className="break-all">
                                {t(
                                    'data_dir_migration.cleanup.settings_description',
                                    {
                                        path: appDataDirState.cleanupPending
                                            .oldDir,
                                        size: appDataDirState.cleanupPending
                                            .bytes
                                    }
                                )}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    onClick={onCleanupAppDataDir}
                                >
                                    {t('data_dir_migration.cleanup.action')}
                                </Button>
                                {!appDataDirState.cleanupPending.dismissed ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={onDismissAppDataDirCleanup}
                                    >
                                        {t(
                                            'data_dir_migration.cleanup.dismiss'
                                        )}
                                    </Button>
                                ) : null}
                            </div>
                        </AlertDescription>
                    </Alert>
                ) : null}
                <Field
                    label={t(
                        'view.settings.advanced.advanced_ui.storage.cache_header'
                    )}
                    description={t(
                        'view.settings.advanced.advanced_ui.storage.cache_description'
                    )}
                >
                    <Switch
                        checked={prefs.autoSweepVRChatCache}
                        onCheckedChange={onAutoSweepVRChatCacheChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.advanced.advanced_ui.storage.keep_avatar_data'
                    )}
                    description={t(
                        'view.settings.advanced.advanced_ui.storage.avatar_cleanup_description'
                    )}
                    controlId="settings-avatar-auto-cleanup"
                >
                    <Select
                        value={prefs.avatarAutoCleanup}
                        items={avatarAutoCleanupOptions.map((value) => ({
                            value,
                            label:
                                value === 'Off'
                                    ? t(
                                          'view.settings.advanced.advanced.database_cleanup.auto_cleanup_off'
                                      )
                                    : t(
                                          `view.settings.advanced.advanced.database_cleanup.auto_cleanup_${value}`
                                      )
                        }))}
                        onValueChange={(value) =>
                            onAvatarAutoCleanupChange(value ?? '')
                        }
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
            </SettingsGroup>

            <AdvancedTroubleshootingGroup
                prefs={prefs}
                sqliteTableSizes={sqliteTableSizes}
                sqliteTableSizeRows={sqliteTableSizeRows}
                onlineVisitCount={onlineVisitCount}
                configTreeData={configTreeData}
                onRefreshSqliteTableSizes={onRefreshSqliteTableSizes}
                onRefreshOnlineVisits={onRefreshOnlineVisits}
                onRefreshConfigTreeData={onRefreshConfigTreeData}
                onClearConfigTreeData={onClearConfigTreeData}
                onGameLogDisabledChange={onGameLogDisabledChange}
                onLogResourceLoadChange={onLogResourceLoadChange}
                onUdonExceptionLoggingChange={onUdonExceptionLoggingChange}
            />

            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced_ui.import_recovery.header'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced_ui.import_recovery.import_from_vrcx'
                    )}
                    description={t(
                        'view.settings.advanced.advanced_ui.import_recovery.description'
                    )}
                >
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onMigrateLegacyVrcxData}
                    >
                        {t(
                            'view.settings.advanced.advanced_ui.import_recovery.review'
                        )}
                    </Button>
                </Field>
            </SettingsGroup>
            <SettingsGroup
                title={t(
                    'view.settings.advanced.advanced_ui.usage_data.header'
                )}
            >
                <Field
                    label={t(
                        'view.settings.advanced.advanced_ui.usage_data.share'
                    )}
                    description={t(
                        'view.settings.advanced.advanced_ui.usage_data.description'
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
                            'view.settings.advanced.advanced_ui.danger.avatar_history'
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
                                'view.settings.advanced.advanced_ui.danger.delete'
                            )}
                        </Button>
                    </Field>
                </div>
            </section>
        </SettingsTabContent>
    );
}
