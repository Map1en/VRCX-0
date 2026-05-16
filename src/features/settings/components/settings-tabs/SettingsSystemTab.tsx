// @ts-nocheck
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';

export function SettingsSystemTab({
    t,
    hostPlatform = 'unknown',
    isStartAtWindowsStartup,
    isStartAsMinimizedState,
    isCloseToTray,
    autoLoginDelayEnabled,
    autoLoginDelaySeconds,
    onStartAtWindowsStartupChange,
    onStartAsMinimizedChange,
    onCloseToTrayChange,
    onAutoLoginDelayEnabledChange,
    onPromptAutoLoginDelaySeconds,
    onProxySettings
}) {
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

    return (
        <SettingsTabContent value="system">
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.general.application.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={startupLabel}
                        description={startupDescription}
                    >
                        <Switch
                            checked={isStartAtWindowsStartup}
                            onCheckedChange={onStartAtWindowsStartupChange}
                        />
                    </Field>
                    <Field
                        label={t('view.settings.general.application.minimized')}
                    >
                        <Switch
                            checked={isStartAsMinimizedState}
                            onCheckedChange={onStartAsMinimizedChange}
                        />
                    </Field>
                    <Field label={t('view.settings.general.application.tray')}>
                        <Switch
                            checked={isCloseToTray}
                            onCheckedChange={onCloseToTrayChange}
                        />
                    </Field>
                    <Field
                        label={t(
                            'view.settings.general.logging.auto_login_delay'
                        )}
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
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onProxySettings}
                        >
                            {t('view.settings.general.application.proxy')}
                        </Button>
                    </Field>
                </CardContent>
            </Card>
        </SettingsTabContent>
    );
}
