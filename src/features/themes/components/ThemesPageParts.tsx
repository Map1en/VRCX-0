import { BadgeCheckIcon, DownloadIcon, ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { openExternalLink } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { CommunityThemeManifest } from '../communityThemeTypes';
import { resolveThemeAuthorUrl } from '../themeHelpers';

export function ThemeTags({ tags }: { tags: string[] }) {
    return (
        <div className="flex min-w-0 flex-wrap gap-1.5">
            {tags.map((tag: any) => (
                <Badge key={tag} variant="secondary" className="font-normal">
                    {tag}
                </Badge>
            ))}
        </div>
    );
}

export function ThemeSourceButton({
    active,
    children,
    onClick
}: {
    active: boolean;
    children: ReactNode;
    onClick: () => void;
}) {
    return (
        <Button
            type="button"
            variant={active ? 'default' : 'outline'}
            size="sm"
            className="h-7 justify-start gap-1.5 rounded-md px-2.5"
            onClick={onClick}
        >
            {active ? <BadgeCheckIcon data-icon="inline-start" /> : null}
            {children}
        </Button>
    );
}

export function ThemeCatalogCard({
    theme,
    active,
    installed,
    updateAvailable,
    downloads,
    loading,
    onInstall,
    t
}: {
    theme: CommunityThemeManifest;
    active: boolean;
    installed: boolean;
    updateAvailable: boolean;
    downloads: number;
    loading: boolean;
    onInstall: () => void;
    t: (key: string, options?: any) => string;
}) {
    const authorUrl = resolveThemeAuthorUrl(theme);

    return (
        <Card
            size="sm"
            className={`min-w-0 ${active && !updateAvailable ? 'opacity-70' : ''}`}
        >
            <CardHeader className="gap-1.5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="truncate text-sm">
                            {theme.name}
                        </CardTitle>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <p className="text-muted-foreground mt-1 line-clamp-2 h-8 text-xs leading-4">
                                        {theme.description}
                                    </p>
                                }
                            />
                            <TooltipContent className="max-w-72">
                                {theme.description}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                    {active ? (
                        <Badge className="shrink-0">
                            <BadgeCheckIcon data-icon="inline-start" />
                            {t('view.community_themes.status.active')}
                        </Badge>
                    ) : installed ? (
                        <Badge variant="secondary" className="shrink-0">
                            {t('view.community_themes.status.installed')}
                        </Badge>
                    ) : null}
                </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-col gap-2.5">
                <div className="bg-muted overflow-hidden rounded-md border">
                    <img
                        src={theme.previewUrl}
                        alt={theme.name}
                        className="aspect-video w-full object-cover"
                        loading="lazy"
                    />
                </div>
                <ThemeTags tags={theme.tags} />
                <div className="grid gap-1 text-xs">
                    <div className="text-muted-foreground">
                        {t('view.community_themes.field.author')}:{' '}
                        <Button
                            type="button"
                            variant="link"
                            size="xs"
                            className="inline-flex h-auto max-w-full justify-start gap-1 p-0 align-baseline text-xs font-normal"
                            title={authorUrl}
                            onClick={() => {
                                void openExternalLink(authorUrl);
                            }}
                        >
                            <span className="truncate">
                                {theme.author.name}
                            </span>
                            <ExternalLinkIcon data-icon="inline-end" />
                        </Button>
                    </div>
                    <div className="text-muted-foreground">
                        {t('view.community_themes.field.version')}:{' '}
                        {theme.version}
                    </div>
                    <div className="text-muted-foreground">
                        {t('view.community_themes.field.tested_with')}:{' '}
                        {theme.testedWith}
                    </div>
                    <div className="text-muted-foreground">
                        {t('view.community_themes.field.downloads')}:{' '}
                        {downloads.toLocaleString()}
                    </div>
                </div>
                <Button
                    type="button"
                    size="sm"
                    className="w-fit"
                    variant={active && !updateAvailable ? 'outline' : 'default'}
                    disabled={loading || (active && !updateAvailable)}
                    onClick={onInstall}
                >
                    {active && !updateAvailable ? (
                        <BadgeCheckIcon data-icon="inline-start" />
                    ) : (
                        <DownloadIcon data-icon="inline-start" />
                    )}
                    {updateAvailable
                        ? t('view.community_themes.action.update_enable')
                        : installed
                          ? active
                              ? t('view.community_themes.status.active')
                              : t('view.community_themes.action.enable_theme')
                          : t('view.community_themes.action.install')}
                </Button>
            </CardContent>
        </Card>
    );
}
