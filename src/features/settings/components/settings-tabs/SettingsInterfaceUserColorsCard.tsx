import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import {
    isValidTrustColor,
    TRUST_COLOR_DEFAULTS,
    TRUST_COLOR_ENTRIES
} from '@/shared/utils/trustColors';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { Field, SettingsGroup } from '../SettingsField';

function getTrustColorInputValue(
    prefs: any,
    key: keyof typeof TRUST_COLOR_DEFAULTS
) {
    const value = prefs.trustColor?.[key];
    return isValidTrustColor(value) ? value : TRUST_COLOR_DEFAULTS[key];
}

function getTrustColorDraftValue(
    prefs: any,
    key: keyof typeof TRUST_COLOR_DEFAULTS
) {
    return prefs.trustColor?.[key] || TRUST_COLOR_DEFAULTS[key];
}

export function SettingsInterfaceUserColorsCard({
    prefs,
    onRandomUserColoursChange,
    onResetTrustColors,
    onSaveTrustColor,
    onTrustColorDraftChange
}: any) {
    const { t } = useTranslation();
    const [trustColorsOpen, setTrustColorsOpen] = useState(false);

    return (
        <SettingsGroup title={t('view.settings.appearance.user_colors.header')}>
            <Field
                label={t(
                    'view.settings.appearance.user_colors.random_colors_from_user_id'
                )}
                description={t(
                    'view.settings.appearance.user_colors.random_colors_from_user_id_description'
                )}
            >
                <Switch
                    checked={prefs.randomUserColours}
                    onCheckedChange={onRandomUserColoursChange}
                />
            </Field>
            <Collapsible
                open={trustColorsOpen}
                onOpenChange={setTrustColorsOpen}
                className="rounded-lg border"
            >
                <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="text-sm font-medium">
                            {t(
                                'view.settings.appearance.user_colors.trust_colors'
                            )}
                        </div>
                        <div className="text-muted-foreground text-sm">
                            {t(
                                'view.settings.appearance.user_colors.trust_colors_description'
                            )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                            {TRUST_COLOR_ENTRIES.map((entry: any) => {
                                const color = getTrustColorInputValue(
                                    prefs,
                                    entry.key
                                );
                                return (
                                    <span
                                        key={entry.key}
                                        className="border-border size-4 rounded-full border"
                                        style={{
                                            backgroundColor: color
                                        }}
                                        aria-label={`${t(entry.labelKey)} ${color}`}
                                        title={t(entry.labelKey)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                    <CollapsibleTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 justify-between"
                        >
                            {t('common.actions.configure')}
                            <ChevronDownIcon
                                data-icon="inline-end"
                                className={cn(
                                    'opacity-50 transition-transform',
                                    trustColorsOpen && 'rotate-180'
                                )}
                            />
                        </Button>
                    </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                    <div className="flex flex-col gap-3 border-t p-3">
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onResetTrustColors}
                            >
                                {t('dialog.shared_feed_filters.reset')}
                            </Button>
                        </div>
                        <div className="flex flex-col gap-2">
                            {TRUST_COLOR_ENTRIES.map((entry: any) => (
                                <div
                                    key={entry.key}
                                    className="grid gap-2 rounded-md border p-2.5 md:grid-cols-[minmax(7rem,1fr)_minmax(5rem,auto)_minmax(0,240px)] md:items-center"
                                >
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span
                                            className="border-border size-3 rounded-full border"
                                            style={{
                                                backgroundColor:
                                                    getTrustColorInputValue(
                                                        prefs,
                                                        entry.key
                                                    )
                                            }}
                                        />
                                        <span
                                            className={cn(
                                                'truncate text-sm font-medium',
                                                entry.className
                                            )}
                                        >
                                            {t(entry.labelKey)}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {entry.presets.map((preset: any) => (
                                            <Button
                                                key={preset}
                                                type="button"
                                                variant="outline"
                                                size="icon-sm"
                                                className="size-6 p-0"
                                                style={{
                                                    backgroundColor: preset
                                                }}
                                                aria-label={`${t(entry.labelKey)} ${preset}`}
                                                onClick={() =>
                                                    onSaveTrustColor(
                                                        entry.key,
                                                        preset
                                                    )
                                                }
                                            />
                                        ))}
                                    </div>
                                    <div className="flex min-w-0 items-center gap-2">
                                        <Input
                                            type="color"
                                            className="h-8 w-11 shrink-0 p-1"
                                            value={getTrustColorInputValue(
                                                prefs,
                                                entry.key
                                            )}
                                            onChange={(event: any) =>
                                                onSaveTrustColor(
                                                    entry.key,
                                                    event.target.value
                                                )
                                            }
                                        />
                                        <Input
                                            value={getTrustColorDraftValue(
                                                prefs,
                                                entry.key
                                            )}
                                            onChange={(event: any) =>
                                                onTrustColorDraftChange(
                                                    entry.key,
                                                    event.target.value
                                                )
                                            }
                                            onBlur={(event: any) =>
                                                onSaveTrustColor(
                                                    entry.key,
                                                    event.target.value
                                                )
                                            }
                                            className="min-w-0 font-mono"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </SettingsGroup>
    );
}
import { useTranslation } from 'react-i18next';
