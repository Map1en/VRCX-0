import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SettingsGroup } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

type SettingsSystemTabProps = {
    autoBackgroundDownloadUpdates?: boolean;
    autoInstallUpdatesOnStartup?: boolean;
    autoLoginDelayEnabled?: boolean;
    autoLoginDelaySeconds?: ReactNode;
    backgroundModeEnabled?: boolean;
    backgroundModeDelayEnabled?: boolean;
    backgroundModeDelayMinutes?: ReactNode;
    hostPlatform?: string;
    isCloseToTray?: boolean;
    isStartAsMinimizedState?: boolean;
    isStartAtWindowsStartup?: boolean;
    proxyEnabled?: boolean;
    proxyServer?: string;
    showPostUpdateChangelogToast?: boolean;
    onAutoBackgroundDownloadUpdatesChange: (checked: boolean) => unknown;
    onAutoInstallUpdatesOnStartupChange: (checked: boolean) => unknown;
    onAutoLoginDelayEnabledChange: (checked: boolean) => unknown;
    onBackgroundModeEnabledChange: (checked: boolean) => unknown;
    onBackgroundModeDelayEnabledChange: (checked: boolean) => unknown;
    onCloseToTrayChange: (checked: boolean) => unknown;
    onPromptAutoLoginDelaySeconds: () => unknown;
    onPromptBackgroundModeDelayMinutes: () => unknown;
    onProxyEnabledChange: (checked: boolean) => unknown;
    onProxySettings: () => unknown;
    onPostUpdateChangelogToastChange: (checked: boolean) => unknown;
    onStartAsMinimizedChange: (checked: boolean) => unknown;
    onStartAtWindowsStartupChange: (checked: boolean) => unknown;
};

export function SettingsSystemTab({
    hostPlatform = 'unknown',
    isStartAtWindowsStartup,
    isStartAsMinimizedState,
    isCloseToTray,
    autoLoginDelayEnabled,
    autoLoginDelaySeconds,
    autoInstallUpdatesOnStartup,
    autoBackgroundDownloadUpdates,
    showPostUpdateChangelogToast,
    backgroundModeEnabled,
    backgroundModeDelayEnabled,
    backgroundModeDelayMinutes,
    proxyEnabled,
    proxyServer,
    onStartAtWindowsStartupChange,
    onStartAsMinimizedChange,
    onCloseToTrayChange,
    onAutoLoginDelayEnabledChange,
    onPromptAutoLoginDelaySeconds,
    onBackgroundModeEnabledChange,
    onBackgroundModeDelayEnabledChange,
    onPromptBackgroundModeDelayMinutes,
    onAutoInstallUpdatesOnStartupChange,
    onAutoBackgroundDownloadUpdatesChange,
    onPostUpdateChangelogToastChange,
    onProxyEnabledChange,
    onProxySettings
}: SettingsSystemTabProps) {
    const { t } = useTranslation();
    const startupLabel =
        hostPlatform === 'linux'
            ? t('view.settings.general.application.startup_system', {
                  defaultValue: 'Start at System Startup'
              })
            : t('view.settings.general.application.startup');
    const startupDescription =
        hostPlatform === 'linux'
            ? t(
                  'view.settings.general.application.startup_system_description',
                  {
                      defaultValue:
                          'Creates a desktop autostart entry that launches VRCX-0 with --autostart.'
                  }
              )
            : '';
    const backgroundModeDelayDisabled =
        !isCloseToTray || !backgroundModeEnabled;

    return (
        <SettingsTabContent value="system">
            <SettingsGroup
                title={t('view.settings.general.application.header')}
            >
                <Field label={startupLabel} description={startupDescription}>
                    <Switch
                        checked={isStartAtWindowsStartup}
                        onCheckedChange={onStartAtWindowsStartupChange}
                    />
                </Field>
                <Field label={t('view.settings.general.application.minimized')}>
                    <Switch
                        checked={isStartAsMinimizedState}
                        onCheckedChange={onStartAsMinimizedChange}
                    />
                </Field>
                <Field
                    label={t('view.settings.general.application.tray')}
                    description={t(
                        'view.settings.general.application.tray_description'
                    )}
                >
                    <Switch
                        checked={isCloseToTray}
                        onCheckedChange={onCloseToTrayChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.general.application.background_mode',
                        {
                            defaultValue:
                                'Switch to Background Mode When Minimized to Tray'
                        }
                    )}
                    description={t(
                        'view.settings.general.application.background_mode_description',
                        {
                            defaultValue:
                                'When closing VRCX-0 to the system tray, switch to Background Mode for ultra-low memory usage, around one-tenth. Some page state may reset after restore.'
                        }
                    )}
                    disabled={!isCloseToTray}
                >
                    <Switch
                        checked={backgroundModeEnabled}
                        disabled={!isCloseToTray}
                        onCheckedChange={onBackgroundModeEnabledChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.general.application.background_mode_delay'
                    )}
                    description={t(
                        'view.settings.general.application.background_mode_delay_description'
                    )}
                    disabled={backgroundModeDelayDisabled}
                >
                    <Switch
                        checked={backgroundModeDelayEnabled}
                        disabled={backgroundModeDelayDisabled}
                        onCheckedChange={onBackgroundModeDelayEnabledChange}
                    />
                </Field>
                {backgroundModeDelayEnabled ? (
                    <Field
                        label={t(
                            'view.settings.general.application.background_mode_delay_button'
                        )}
                        disabled={backgroundModeDelayDisabled}
                    >
                        <div className="flex items-center gap-2">
                            <Badge variant="outline">
                                {backgroundModeDelayMinutes}
                                {t('common.time_units.m')}
                            </Badge>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={backgroundModeDelayDisabled}
                                onClick={onPromptBackgroundModeDelayMinutes}
                            >
                                {t(
                                    'view.settings.general.application.background_mode_delay_button'
                                )}
                            </Button>
                        </div>
                    </Field>
                ) : null}
                <Field
                    label={t(
                        'view.settings.general.application.auto_install_updates_on_startup'
                    )}
                    description={t(
                        'view.settings.general.application.auto_install_updates_on_startup_description'
                    )}
                >
                    <Switch
                        checked={autoInstallUpdatesOnStartup}
                        onCheckedChange={onAutoInstallUpdatesOnStartupChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.general.application.auto_background_download_updates'
                    )}
                    description={t(
                        'view.settings.general.application.auto_background_download_updates_description'
                    )}
                >
                    <Switch
                        checked={autoBackgroundDownloadUpdates}
                        onCheckedChange={onAutoBackgroundDownloadUpdatesChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.notifications.notifications.post_update_changelog_prompt'
                    )}
                    description={t(
                        'view.settings.notifications.notifications.post_update_changelog_prompt_description'
                    )}
                >
                    <Switch
                        checked={showPostUpdateChangelogToast}
                        onCheckedChange={onPostUpdateChangelogToastChange}
                    />
                </Field>
                <Field
                    label={t('view.settings.general.logging.auto_login_delay')}
                >
                    <Switch
                        checked={autoLoginDelayEnabled}
                        onCheckedChange={onAutoLoginDelayEnabledChange}
                    />
                </Field>
                {autoLoginDelayEnabled ? (
                    <Field
                        label={t(
                            'view.settings.general.logging.auto_login_delay_button'
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <Badge variant="outline">
                                {autoLoginDelaySeconds}
                                {t('common.time_units.s')}
                            </Badge>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onPromptAutoLoginDelaySeconds}
                            >
                                {t(
                                    'view.settings.general.logging.auto_login_delay_button'
                                )}
                            </Button>
                        </div>
                    </Field>
                ) : null}
                <Field label={t('view.settings.general.application.proxy')}>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Switch
                            checked={proxyEnabled}
                            onCheckedChange={onProxyEnabledChange}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onProxySettings}
                        >
                            {proxyServer
                                ? t('prompt.proxy_settings.configure')
                                : t('prompt.proxy_settings.configure_empty')}
                        </Button>
                    </div>
                </Field>
            </SettingsGroup>
        </SettingsTabContent>
    );
}
