import {
    BellIcon,
    BotIcon,
    ImageIcon,
    type LucideIcon,
    MonitorIcon,
    PaletteIcon,
    PlugIcon,
    RectangleGogglesIcon,
    TerminalIcon,
    UsersIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    PageDescription,
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { SettingsAiTab } from './components/settings-tabs/SettingsAiTab';
import { SettingsIntegrationsTab } from './components/settings-tabs/SettingsIntegrationsTab';
import { SettingsInterfaceTab } from './components/settings-tabs/SettingsInterfaceTab';
import { SettingsMediaTab } from './components/settings-tabs/SettingsMediaTab';
import { SettingsSocialTab } from './components/settings-tabs/SettingsSocialTab';
import { SettingsAdvancedSection } from './components/SettingsAdvancedSection';
import { SettingsDialogsSection } from './components/SettingsDialogsSection';
import { SettingsNotificationsSection } from './components/SettingsNotificationsSection';
import { SettingsSystemSection } from './components/SettingsSystemSection';
import { SettingsVrSection } from './components/SettingsVrSection';
import { useSettingsPageController } from './useSettingsPageController';

const SETTINGS_TAB_ICONS: Record<string, LucideIcon> = {
    system: MonitorIcon,
    interface: PaletteIcon,
    social: UsersIcon,
    ai: BotIcon,
    notifications: BellIcon,
    vr: RectangleGogglesIcon,
    media: ImageIcon,
    integrations: PlugIcon,
    advanced: TerminalIcon
};

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
        vr,
        advanced,
        dialogs
    } = pageState;

    return (
        <PageScaffold className="flex-1">
            <PageHeader>
                <PageTitle>{t('view.settings.header')}</PageTitle>
                <PageDescription>{t('view.settings.subtitle')}</PageDescription>
            </PageHeader>
            <Tabs
                orientation="vertical"
                value={shell.activeSettingsTab}
                onValueChange={shell.setActiveSettingsTab}
                className="flex min-h-0 flex-1 gap-4"
            >
                <TabsList className="h-fit w-44 shrink-0 gap-0.5 self-start">
                    {shell.settingsTabs.map(([value, labelKey]) => {
                        const Icon = SETTINGS_TAB_ICONS[value];
                        return (
                            <TabsTrigger
                                key={value}
                                value={value}
                                className="justify-start gap-2.5 px-3 py-1.5"
                            >
                                {Icon ? <Icon /> : null}
                                {t(labelKey)}
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <SettingsSystemSection system={system} />
                    <SettingsInterfaceTab
                        settingsInterface={settingsInterface}
                    />
                    <SettingsSocialTab social={social} />
                    <SettingsNotificationsSection
                        notifications={notifications}
                    />
                    <SettingsVrSection vr={vr} />
                    <SettingsMediaTab media={media} />
                    <SettingsAiTab />
                    <SettingsIntegrationsTab integrations={integrations} />
                    <SettingsAdvancedSection advanced={advanced} />
                </div>
            </Tabs>
            <SettingsDialogsSection dialogs={dialogs} />
        </PageScaffold>
    );
}
