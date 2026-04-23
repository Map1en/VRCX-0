import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField.jsx';
import { SettingsTabContent } from '../SettingsViewParts.jsx';

export function SettingsSystemTab({
    t,
    versionText,
    isStartAtWindowsStartup,
    isStartAsMinimizedState,
    isCloseToTray,
    onOpenRepository,
    onOpenSupport,
    onStartAtWindowsStartupChange,
    onStartAsMinimizedChange,
    onCloseToTrayChange,
    onProxySettings,
    onOpenSourceNotice
}) {
    return (
        <SettingsTabContent value="system">
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.general.general.header')}
                    </CardTitle>
                    <CardDescription>
                        {t('view.settings.general.general.version')}: {versionText}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onOpenRepository}
                        >
                            {t('view.settings.general.general.repository_url')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onOpenSupport}
                        >
                            {t('view.settings.general.general.support')}
                        </Button>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.general.application.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <Field
                        label={t('view.settings.general.application.startup')}
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
            <Card>
                <CardHeader>
                    <CardTitle>
                        {t('view.settings.general.legal_notice.header')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                    <div className="text-muted-foreground rounded-lg border p-4 text-sm">
                        <p>
                            {t('view.settings.general.legal_notice.info')}
                        </p>
                        <p>
                            {t(
                                'view.settings.general.legal_notice.disclaimer1'
                            )}
                        </p>
                        <p>
                            {t(
                                'view.settings.general.legal_notice.disclaimer2'
                            )}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onOpenSourceNotice}
                        >
                            {t(
                                'view.settings.general.legal_notice.open_source_software_notice'
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </SettingsTabContent>
    );
}
