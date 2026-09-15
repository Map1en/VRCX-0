import { useTranslation } from 'react-i18next';

import { PrivacyLockSetting } from '@/features/privacy-lock/PrivacyLockSetting';
import type { HostPlatform } from '@/platform/tauri/bindings';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import { LinuxRenderingSetting } from '../LinuxRenderingSetting';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { TrayShortcutSetting } from '../TrayShortcutSetting';
import { useSettingsSystemTabState } from '../useSettingsSystemTabState';

type SettingsSystemTabContentProps = {
    autoInstallUpdatesOnStartup?: boolean;
    autoLoginDelayEnabled?: boolean;
    autoLoginDelaySeconds?: number;
    backgroundModeEnabled?: boolean;
    backgroundModeDelayEnabled?: boolean;
    backgroundModeDelayMinutes?: number;
    hostPlatform?: HostPlatform;
    isCloseToTray?: boolean;
    isStartAsMinimizedState?: boolean;
    isStartAtWindowsStartup?: boolean;
    systemWindowFrame?: boolean;
    proxyEnabled?: boolean;
    proxyServer?: string;
    showPostUpdateChangelogToast?: boolean;
    updateCheckDisabled?: boolean;
    onAutoInstallUpdatesOnStartupChange: (checked: boolean) => void;
    onAutoLoginDelayEnabledChange: (checked: boolean) => void;
    onBackgroundModeEnabledChange: (checked: boolean) => void;
    onBackgroundModeDelayEnabledChange: (checked: boolean) => void;
    onCloseToTrayChange: (checked: boolean) => void;
    onPromptAutoLoginDelaySeconds: () => void;
    onPromptBackgroundModeDelayMinutes: () => void;
    onProxyEnabledChange: (checked: boolean) => void | Promise<void>;
    onProxySettings: () => void;
    onPostUpdateChangelogToastChange: (checked: boolean) => void;
    onStartAsMinimizedChange: (checked: boolean) => void;
    onStartAtWindowsStartupChange: (checked: boolean) => void;
    onSystemWindowFrameChange: (checked: boolean) => void | Promise<void>;
};

export function SettingsSystemTab() {
    const state = useSettingsSystemTabState();
    return <SettingsSystemTabContent {...state} />;
}

export function SettingsSystemTabContent({
    hostPlatform = 'unknown',
    isStartAtWindowsStartup,
    isStartAsMinimizedState,
    isCloseToTray,
    systemWindowFrame,
    autoLoginDelayEnabled,
    autoLoginDelaySeconds,
    autoInstallUpdatesOnStartup,
    updateCheckDisabled = false,
    showPostUpdateChangelogToast,
    backgroundModeEnabled,
    backgroundModeDelayEnabled,
    backgroundModeDelayMinutes,
    proxyEnabled,
    proxyServer,
    onStartAtWindowsStartupChange,
    onStartAsMinimizedChange,
    onCloseToTrayChange,
    onSystemWindowFrameChange,
    onAutoLoginDelayEnabledChange,
    onPromptAutoLoginDelaySeconds,
    onBackgroundModeEnabledChange,
    onBackgroundModeDelayEnabledChange,
    onPromptBackgroundModeDelayMinutes,
    onAutoInstallUpdatesOnStartupChange,
    onPostUpdateChangelogToastChange,
    onProxyEnabledChange,
    onProxySettings
}: SettingsSystemTabContentProps) {
    const { t } = useTranslation();
    const isWindows = hostPlatform === 'windows';
    const startupLabel = isWindows
        ? t('view.settings.general.application.startup')
        : t('view.settings.general.application.startup_system', {
              defaultValue: 'Start at System Startup'
          });
    const startupDescription = isWindows
        ? ''
        : t('view.settings.general.application.startup_system_description', {
              defaultValue:
                  'Creates a desktop autostart entry that launches VRCX-0 with --autostart.'
          });

    return (
        <SettingsTabContent value="system">
            <SettingsCard
                cardId="system.application"
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
                {isWindows ? <TrayShortcutSetting /> : null}
                <PrivacyLockSetting />
                {hostPlatform === 'linux' ? <LinuxRenderingSetting /> : null}
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
                >
                    <Switch
                        checked={backgroundModeEnabled}
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
                >
                    <Switch
                        checked={backgroundModeDelayEnabled}
                        onCheckedChange={onBackgroundModeDelayEnabledChange}
                    />
                </Field>
                {backgroundModeDelayEnabled ? (
                    <Field
                        label={t(
                            'view.settings.general.application.background_mode_delay_button'
                        )}
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
                                onClick={onPromptBackgroundModeDelayMinutes}
                            >
                                {t(
                                    'view.settings.general.application.background_mode_delay_button'
                                )}
                            </Button>
                        </div>
                    </Field>
                ) : null}
                {isWindows ? (
                    <Field
                        label={t(
                            'view.settings.general.application.system_window_frame'
                        )}
                        description={t(
                            'view.settings.general.application.system_window_frame_description'
                        )}
                    >
                        <Switch
                            checked={systemWindowFrame}
                            onCheckedChange={onSystemWindowFrameChange}
                        />
                    </Field>
                ) : null}
                {updateCheckDisabled ? (
                    <Field
                        label={t(
                            'view.settings.general.application.check_for_updates_and_update'
                        )}
                        description={t(
                            'view.settings.general.application.update_check_disabled_build_description'
                        )}
                    >
                        <Badge variant="secondary">
                            {t(
                                'view.settings.general.application.update_check_disabled'
                            )}
                        </Badge>
                    </Field>
                ) : (
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
                            onCheckedChange={
                                onAutoInstallUpdatesOnStartupChange
                            }
                        />
                    </Field>
                )}
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
            </SettingsCard>
        </SettingsTabContent>
    );
}
