import {
    BellIcon,
    BotIcon,
    ImageIcon,
    type LucideIcon,
    MessageSquareIcon,
    MonitorIcon,
    PaletteIcon,
    PlugIcon,
    RectangleGogglesIcon,
    TerminalIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
    PageDescription,
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { ToolbarSearch } from '@/components/layout/ToolbarControls';
import { useSettingsSearch } from '@/lib/useSettingsSearch';
import { cn } from '@/lib/utils';
import type { SettingsManifestEntry } from '@/shared/constants/settingsManifest';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { RestartPendingNotice } from './components/RestartPendingNotice';
import { SettingsAdvancedTab } from './components/settings-tabs/SettingsAdvancedTab';
import { SettingsAiTab } from './components/settings-tabs/SettingsAiTab';
import { SettingsFeedbackTab } from './components/settings-tabs/SettingsFeedbackTab';
import { SettingsIntegrationsTab } from './components/settings-tabs/SettingsIntegrationsTab';
import { SettingsInterfaceTab } from './components/settings-tabs/SettingsInterfaceTab';
import { SettingsMediaTab } from './components/settings-tabs/SettingsMediaTab';
import { SettingsNotificationsTab } from './components/settings-tabs/SettingsNotificationsTab';
import { SettingsSocialTab } from './components/settings-tabs/SettingsSocialTab';
import { SettingsSystemTab } from './components/settings-tabs/SettingsSystemTab';
import { SettingsVrTab } from './components/settings-tabs/SettingsVrTab';
import { SettingsDialogs } from './components/SettingsDialogs';
import { SettingsSearchResults } from './components/SettingsSearchResults';
import {
    SettingsPageStateProvider,
    useSettingsPageSection
} from './SettingsPageStateContext';
import { useSettingDeepLink } from './useSettingDeepLink';

const SETTINGS_TAB_ICONS: Record<string, LucideIcon> = {
    system: MonitorIcon,
    interface: PaletteIcon,
    social: UsersIcon,
    ai: BotIcon,
    notifications: BellIcon,
    vr: RectangleGogglesIcon,
    media: ImageIcon,
    integrations: PlugIcon,
    advanced: TerminalIcon,
    feedback: MessageSquareIcon
};

export function SettingsPage() {
    return (
        <SettingsPageStateProvider>
            <SettingsPageContent />
        </SettingsPageStateProvider>
    );
}

function SettingsPageContent() {
    const { t } = useTranslation();
    const shell = useSettingsPageSection('shell');
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedSettingId = searchParams.get('setting');
    const [query, setQuery] = useState('');
    const searching = query.trim().length > 0;
    const results = useSettingsSearch(query);
    useSettingDeepLink();

    useEffect(() => {
        if (requestedSettingId) {
            setQuery('');
        }
    }, [requestedSettingId]);

    function openSetting(entry: SettingsManifestEntry) {
        setQuery('');
        setSearchParams(
            (current) => {
                current.set('tab', entry.tab);
                current.set('setting', entry.id);
                return current;
            },
            { replace: true }
        );
    }

    return (
        <PageScaffold className="flex-1">
            <div className="flex items-start justify-between gap-4">
                <PageHeader>
                    <PageTitle>{t('view.settings.header')}</PageTitle>
                    <PageDescription>
                        {t('view.settings.subtitle')}
                    </PageDescription>
                </PageHeader>
                <ToolbarSearch
                    className="mt-1.5"
                    value={query}
                    onValueChange={setQuery}
                    commitOnBlur={false}
                    placeholder={t('view.settings.search.placeholder')}
                    onCommit={() => {
                        if (results[0]) {
                            openSetting(results[0]);
                        }
                    }}
                />
            </div>
            <RestartPendingNotice />
            <Tabs
                orientation="vertical"
                value={shell.activeSettingsTab}
                onValueChange={(value) => {
                    setQuery('');
                    shell.setActiveSettingsTab(value);
                }}
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
                {searching ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <SettingsSearchResults
                            results={results}
                            onSelect={openSetting}
                        />
                    </div>
                ) : null}
                <div
                    className={cn(
                        'flex min-h-0 min-w-0 flex-1 flex-col',
                        searching && 'hidden'
                    )}
                >
                    <SettingsSystemTab />
                    <SettingsInterfaceTab />
                    <SettingsSocialTab />
                    <SettingsNotificationsTab />
                    <SettingsVrTab />
                    <SettingsMediaTab />
                    <SettingsAiTab active={shell.activeSettingsTab === 'ai'} />
                    <SettingsIntegrationsTab />
                    <SettingsAdvancedTab />
                    <SettingsFeedbackTab />
                </div>
            </Tabs>
            <SettingsDialogs />
        </PageScaffold>
    );
}
