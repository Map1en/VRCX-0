import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
    PageBody,
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { useRouteScrollMemory } from '@/lib/useRouteScrollMemory';

import { AccentColorPicker } from './components/AccentColorPicker';
import { BackgroundImageSection } from './components/BackgroundImageSection';
import { CommunityThemesSection } from './components/CommunityThemesSection';
import { CustomCssSection } from './components/CustomCssSection';
import { DeveloperThemesSection } from './components/DeveloperThemesSection';
import { ThemeSourceSelector } from './components/ThemeSourceSelector';
import { useThemesController } from './useThemesController';

export function ThemesPage() {
    const { t } = useTranslation();
    const {
        themeMode,
        themeColor,
        catalog,
        enabled,
        installedTheme,
        installedThemes,
        installedThemeById,
        localPreview,
        overrideCssLength,
        loading,
        error,
        overrideDraft,
        setOverrideDraft,
        customCssOpen,
        setCustomCssOpen,
        devFolderPath,
        devLoading,
        devSectionOpen,
        setDevSectionOpen,
        themeStatsById,
        devWatchEnabled,
        devError,
        developerToolsAvailable,
        visibleSource,
        accentControlled,
        customCssBadge,
        installTheme,
        disableTheme,
        deleteTheme,
        enableTheme,
        updateTheme,
        updateByThemeId,
        saveOverride,
        clearOverride,
        disableOverride,
        selectBuiltInSource,
        selectBackgroundSource,
        selectCommunitySource,
        loadLocalPreview,
        toggleLocalPreviewWatch,
        pickLocalThemeFolder,
        stopLocalPreview,
        updateThemeMode,
        updateThemeColor
    } = useThemesController();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useRouteScrollMemory(scrollRef, 'themes');

    return (
        <PageScaffold className="flex-1">
            <PageHeader>
                <PageTitle>{t('view.themes.header')}</PageTitle>
            </PageHeader>
            <PageBody>
                <div
                    ref={scrollRef}
                    className="min-h-0 flex-1 overflow-y-auto pr-1"
                >
                    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
                        <ThemeSourceSelector
                            customCssBadge={customCssBadge}
                            visibleSource={visibleSource}
                            selectBuiltInSource={selectBuiltInSource}
                            selectBackgroundSource={selectBackgroundSource}
                            selectCommunitySource={selectCommunitySource}
                            themeMode={themeMode}
                            updateThemeMode={updateThemeMode}
                        />

                        {visibleSource === 'background' ? (
                            <BackgroundImageSection />
                        ) : null}

                        {visibleSource === 'community' ? (
                            <CommunityThemesSection
                                error={error}
                                catalog={catalog}
                                installedThemeById={installedThemeById}
                                enabled={enabled}
                                installedTheme={installedTheme}
                                themeStatsById={themeStatsById}
                                loading={loading}
                                enableTheme={enableTheme}
                                installTheme={installTheme}
                                updateTheme={updateTheme}
                                updateByThemeId={updateByThemeId}
                                installedThemes={installedThemes}
                                disableTheme={disableTheme}
                                deleteTheme={deleteTheme}
                                accentControlled={accentControlled}
                            />
                        ) : null}

                        <AccentColorPicker
                            accentControlled={accentControlled}
                            themeColor={themeColor}
                            updateThemeColor={updateThemeColor}
                        />

                        <CustomCssSection
                            customCssOpen={customCssOpen}
                            setCustomCssOpen={setCustomCssOpen}
                            overrideCssLength={overrideCssLength}
                            overrideDraft={overrideDraft}
                            setOverrideDraft={setOverrideDraft}
                            saveOverride={saveOverride}
                            disableOverride={disableOverride}
                            clearOverride={clearOverride}
                        />

                        {developerToolsAvailable ? (
                            <DeveloperThemesSection
                                devSectionOpen={devSectionOpen}
                                setDevSectionOpen={setDevSectionOpen}
                                localPreview={localPreview}
                                devFolderPath={devFolderPath}
                                devLoading={devLoading}
                                devWatchEnabled={devWatchEnabled}
                                devError={devError}
                                pickLocalThemeFolder={pickLocalThemeFolder}
                                loadLocalPreview={loadLocalPreview}
                                toggleLocalPreviewWatch={
                                    toggleLocalPreviewWatch
                                }
                                stopLocalPreview={stopLocalPreview}
                            />
                        ) : null}
                    </div>
                </div>
            </PageBody>
        </PageScaffold>
    );
}
