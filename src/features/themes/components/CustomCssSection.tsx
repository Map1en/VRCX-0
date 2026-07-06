import {
    ChevronDownIcon,
    CodeIcon,
    EraserIcon,
    PaletteIcon,
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
import { Textarea } from '@/ui/shadcn/textarea';

export function CustomCssSection({
    customCssOpen,
    setCustomCssOpen,
    overrideCssLength,
    overrideDraft,
    setOverrideDraft,
    saveOverride,
    disableOverride,
    clearOverride
}: any) {
    const { t } = useTranslation();

    return (
        <Collapsible
            open={customCssOpen}
            onOpenChange={setCustomCssOpen}
            className="border-border/70 bg-card/50 rounded-lg border px-3 py-2.5"
        >
            <div className="flex flex-col gap-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="grid min-w-0 gap-1">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            <CodeIcon data-icon="inline-start" />
                            {t('view.themes.custom_css.header')}
                        </div>
                        <div className="text-muted-foreground text-xs">
                            {overrideCssLength
                                ? t('view.themes.custom_css.enabled_summary', {
                                      count: overrideCssLength
                                  })
                                : t('view.themes.custom_css.disabled_summary')}
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
                                    customCssOpen
                                        ? 'view.themes.custom_css.hide_editor'
                                        : 'view.themes.custom_css.edit'
                                )}
                                <ChevronDownIcon
                                    data-icon="inline-end"
                                    className={cn(
                                        'opacity-60 transition-transform',
                                        customCssOpen && 'rotate-180'
                                    )}
                                />
                            </Button>
                        }
                    />
                </div>
                <CollapsibleContent>
                    <div className="flex flex-col gap-3 border-t pt-3">
                        <Textarea
                            className="min-h-56 font-mono text-xs"
                            spellCheck={false}
                            value={overrideDraft}
                            placeholder={t(
                                'view.community_themes.override.placeholder'
                            )}
                            onChange={(event) =>
                                setOverrideDraft(event.target.value)
                            }
                        />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                size="sm"
                                onClick={saveOverride}
                            >
                                <PaletteIcon data-icon="inline-start" />
                                {t(
                                    'view.community_themes.action.apply_override'
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!overrideCssLength}
                                onClick={disableOverride}
                            >
                                <SquareIcon data-icon="inline-start" />
                                {t(
                                    'view.community_themes.action.disable_override'
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!overrideDraft.trim()}
                                onClick={clearOverride}
                            >
                                <EraserIcon data-icon="inline-start" />
                                {t(
                                    'view.community_themes.action.clear_override'
                                )}
                            </Button>
                        </div>
                    </div>
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
}
