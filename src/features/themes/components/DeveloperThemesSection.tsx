import {
    ChevronDownIcon,
    FolderOpenIcon,
    RefreshCwIcon,
    SquareIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';

export function DeveloperThemesSection({
    devSectionOpen,
    setDevSectionOpen,
    localPreview,
    devFolderPath,
    devLoading,
    devWatchEnabled,
    devError,
    pickLocalThemeFolder,
    loadLocalPreview,
    toggleLocalPreviewWatch,
    stopLocalPreview
}: any) {
    const { t } = useTranslation();

    return (
        <Collapsible
            open={devSectionOpen}
            onOpenChange={setDevSectionOpen}
            className="border-border/70 bg-card/50 rounded-lg border px-3 py-2.5"
        >
            <div className="flex flex-col gap-3 text-sm">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="grid min-w-0 gap-1">
                        <div className="text-sm font-medium">
                            {t('view.community_themes.developer.header')}
                        </div>
                        <div className="text-muted-foreground text-xs">
                            {localPreview
                                ? t('view.themes.developer.preview_active', {
                                      name: localPreview.themeName
                                  })
                                : t('view.themes.developer.summary')}
                        </div>
                    </div>
                    <CollapsibleTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 shrink-0"
                            >
                                {t(
                                    devSectionOpen
                                        ? 'view.themes.developer.hide'
                                        : 'view.themes.developer.show'
                                )}
                                <ChevronDownIcon
                                    data-icon="inline-end"
                                    className={cn(
                                        'opacity-60 transition-transform',
                                        devSectionOpen && 'rotate-180'
                                    )}
                                />
                            </Button>
                        }
                    />
                </div>
                <CollapsibleContent>
                    <div className="flex flex-col gap-3 border-t pt-3">
                        <p className="text-muted-foreground text-xs">
                            {t('view.community_themes.developer.description')}
                        </p>
                        <div className="border-input bg-muted/30 min-h-9 rounded-md border px-3 py-2 font-mono text-xs break-all">
                            {devFolderPath ||
                                t('view.community_themes.developer.no_folder')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                disabled={devLoading}
                                onClick={pickLocalThemeFolder}
                            >
                                <FolderOpenIcon data-icon="inline-start" />
                                {t(
                                    'view.community_themes.developer.select_folder'
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={devLoading || !devFolderPath.trim()}
                                onClick={() => loadLocalPreview()}
                            >
                                <RefreshCwIcon data-icon="inline-start" />
                                {t('view.community_themes.developer.reload')}
                            </Button>
                            <Button
                                type="button"
                                variant={
                                    devWatchEnabled ? 'default' : 'outline'
                                }
                                size="sm"
                                disabled={!devFolderPath.trim()}
                                onClick={toggleLocalPreviewWatch}
                            >
                                <RefreshCwIcon data-icon="inline-start" />
                                {t(
                                    devWatchEnabled
                                        ? 'view.community_themes.developer.stop_watch'
                                        : 'view.community_themes.developer.start_watch'
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!localPreview}
                                onClick={stopLocalPreview}
                            >
                                <SquareIcon data-icon="inline-start" />
                                {t(
                                    'view.community_themes.developer.stop_preview'
                                )}
                            </Button>
                        </div>
                        {devError ? (
                            <p className="text-destructive text-xs">
                                {devError}
                            </p>
                        ) : null}
                        {localPreview ? (
                            <div className="grid gap-1 text-xs">
                                <div>
                                    {t('view.community_themes.field.name')}:{' '}
                                    {localPreview.themeName}
                                </div>
                                <div>
                                    {t('view.community_themes.field.version')}:{' '}
                                    {localPreview.version || '-'}
                                </div>
                                <div>
                                    {t(
                                        'view.community_themes.field.accent_mode'
                                    )}
                                    :{' '}
                                    {localPreview.accentMode
                                        ? t('view.community_themes.value.yes')
                                        : t('view.community_themes.value.no')}
                                </div>
                                <div>
                                    {t(
                                        'view.community_themes.developer.css_size'
                                    )}
                                    : {localPreview.cssLength}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
}
