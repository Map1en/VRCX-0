import { useTranslation } from 'react-i18next';

import {
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { SettingsAdvancedSection } from './components/SettingsAdvancedSection';
import { SettingsDialogsSection } from './components/SettingsDialogsSection';
import { SettingsNotificationsSection } from './components/SettingsNotificationsSection';
import { SettingsSystemSection } from './components/SettingsSystemSection';
import { SettingsIntegrationsTab } from './components/settings-tabs/SettingsIntegrationsTab';
import { SettingsInterfaceTab } from './components/settings-tabs/SettingsInterfaceTab';
import { SettingsMediaTab } from './components/settings-tabs/SettingsMediaTab';
import { SettingsSocialTab } from './components/settings-tabs/SettingsSocialTab';
import { useSettingsPageController } from './useSettingsPageController';

export function SettingsPage() {
    const pageState = useSettingsPageController();
    const { t } = useTranslation();
    const {
        shell,
        system,
        interface: settingsInterface,
        media,
        integrations,
        social,
        notifications,
        advanced,
        dialogs
    } = pageState;

    return (
        <PageScaffold className="flex-1">
            <PageHeader>
                <PageTitle>{t('view.settings.header')}</PageTitle>
            </PageHeader>
            <Tabs
                value={shell.activeSettingsTab}
                onValueChange={shell.setActiveSettingsTab}
                className="flex min-h-0 flex-1 flex-col"
            >
                <div className="max-w-full shrink-0 overflow-x-auto overflow-y-hidden">
                    <TabsList>
                        {shell.settingsTabs.map(([value, labelKey]: any) => (
                            <TabsTrigger key={value} value={value}>
                                {t(labelKey)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                <SettingsSystemSection system={system} />
                <SettingsInterfaceTab settingsInterface={settingsInterface} />
                <SettingsMediaTab media={media} />
                <SettingsIntegrationsTab integrations={integrations} />
                <SettingsSocialTab social={social} />
                <SettingsNotificationsSection notifications={notifications} />
                <SettingsAdvancedSection advanced={advanced} />
            </Tabs>
            <SettingsDialogsSection dialogs={dialogs} />
        </PageScaffold>
    );
}
