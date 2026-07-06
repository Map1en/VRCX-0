import {
    BadgeCheckIcon,
    BrushIcon,
    ExternalLinkIcon,
    Trash2Icon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { openExternalLink } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { CommunityThemeInstallMetadata } from '../communityThemeTypes';
import {
    COMMUNITY_THEMES_REPOSITORY_URL,
    isSameThemeVersion
} from '../themeHelpers';
import { ThemeCatalogCard } from './ThemesPageParts';

export function CommunityThemesSection({
    error,
    catalog,
    installedThemeById,
    enabled,
    installedTheme,
    themeStatsById,
    loading,
    enableTheme,
    installTheme,
    installedThemes,
    disableTheme,
    deleteTheme,
    accentControlled
}: any) {
    const { t } = useTranslation();

    return (
        <Tabs defaultValue="browse" className="flex min-h-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="shrink-0 overflow-x-auto overflow-y-hidden">
                    <TabsList>
                        <TabsTrigger value="browse">
                            {t('view.community_themes.tabs.browse')}
                        </TabsTrigger>
                        <TabsTrigger value="installed">
                            {t('view.community_themes.tabs.installed')}
                        </TabsTrigger>
                    </TabsList>
                </div>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 w-fit shrink-0"
                                onClick={() => {
                                    void openExternalLink(
                                        COMMUNITY_THEMES_REPOSITORY_URL
                                    );
                                }}
                            >
                                <ExternalLinkIcon data-icon="inline-start" />
                                {t('view.community_themes.action.contribute')}
                            </Button>
                        }
                    />
                    <TooltipContent>
                        {t('view.community_themes.action.contribute_tooltip')}
                    </TooltipContent>
                </Tooltip>
            </div>
            <TabsContent value="browse" className="m-0">
                {error ? (
                    <div className="text-destructive p-2 text-sm">{error}</div>
                ) : null}
                {catalog.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,16rem))] justify-start gap-2">
                        {catalog.map((theme: any) => {
                            const installedEntry = installedThemeById.get(
                                theme.id
                            );
                            const active =
                                enabled && installedTheme?.themeId === theme.id;
                            const updateAvailable = Boolean(
                                installedEntry &&
                                !isSameThemeVersion(
                                    installedEntry.version,
                                    theme.version
                                )
                            );
                            return (
                                <ThemeCatalogCard
                                    key={theme.id}
                                    theme={theme}
                                    active={active}
                                    installed={Boolean(installedEntry)}
                                    updateAvailable={updateAvailable}
                                    downloads={
                                        themeStatsById[theme.id]?.downloads ?? 0
                                    }
                                    loading={loading}
                                    t={t}
                                    onInstall={() => {
                                        if (
                                            installedEntry &&
                                            !updateAvailable
                                        ) {
                                            enableTheme(theme.id);
                                            return;
                                        }
                                        installTheme(theme);
                                    }}
                                />
                            );
                        })}
                    </div>
                ) : (
                    <div className="border-border/70 text-muted-foreground rounded-lg border p-4 text-sm">
                        {t('view.community_themes.browse.empty')}
                    </div>
                )}
            </TabsContent>
            <TabsContent value="installed" className="m-0">
                <div className="border-border/70 bg-card/70 rounded-lg border p-3">
                    <div className="mb-3 text-sm font-medium">
                        {t('view.community_themes.installed.header')}
                    </div>
                    {installedThemes.length ? (
                        <div className="grid gap-2">
                            {installedThemes.map(
                                (theme: CommunityThemeInstallMetadata) => {
                                    const active =
                                        enabled &&
                                        installedTheme?.themeId ===
                                            theme.themeId;
                                    return (
                                        <div
                                            key={theme.themeId}
                                            className="border-border/70 bg-muted/20 min-w-0 rounded-md border p-3"
                                        >
                                            <div className="flex flex-col gap-3 text-sm">
                                                <div className="flex min-w-0 items-start justify-between gap-3">
                                                    <div className="grid min-w-0 gap-1 text-xs">
                                                        <div className="font-medium">
                                                            {theme.themeName}
                                                        </div>
                                                        <div className="text-muted-foreground">
                                                            {t(
                                                                'view.community_themes.field.version'
                                                            )}
                                                            : {theme.version}
                                                        </div>
                                                        <div className="text-muted-foreground">
                                                            {t(
                                                                'view.community_themes.field.accent_mode'
                                                            )}
                                                            :{' '}
                                                            {theme.accentMode
                                                                ? t(
                                                                      'view.community_themes.value.yes'
                                                                  )
                                                                : t(
                                                                      'view.community_themes.value.no'
                                                                  )}
                                                        </div>
                                                    </div>
                                                    {active ? (
                                                        <Badge className="shrink-0">
                                                            <BadgeCheckIcon data-icon="inline-start" />
                                                            {t(
                                                                'view.community_themes.status.active'
                                                            )}
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {active ? (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={
                                                                disableTheme
                                                            }
                                                        >
                                                            <BrushIcon data-icon="inline-start" />
                                                            {t(
                                                                'view.community_themes.action.disable_theme'
                                                            )}
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            onClick={() =>
                                                                enableTheme(
                                                                    theme.themeId
                                                                )
                                                            }
                                                        >
                                                            <BrushIcon data-icon="inline-start" />
                                                            {t(
                                                                'view.community_themes.action.enable_theme'
                                                            )}
                                                        </Button>
                                                    )}
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() =>
                                                            deleteTheme(
                                                                theme.themeId
                                                            )
                                                        }
                                                    >
                                                        <Trash2Icon data-icon="inline-start" />
                                                        {t(
                                                            'view.community_themes.action.delete_theme'
                                                        )}
                                                    </Button>
                                                </div>
                                                {active && accentControlled ? (
                                                    <p className="text-muted-foreground text-xs">
                                                        {t(
                                                            'view.community_themes.installed.accent_controlled'
                                                        )}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>
                                    );
                                }
                            )}
                        </div>
                    ) : (
                        <p className="text-muted-foreground text-sm">
                            {t('view.community_themes.installed.empty')}
                        </p>
                    )}
                </div>
            </TabsContent>
        </Tabs>
    );
}
