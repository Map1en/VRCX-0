import {
    isValidTrustColor,
    TRUST_COLOR_DEFAULTS,
    TRUST_COLOR_ENTRIES
} from '@/lib/trustColors.js';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField.jsx';

export function SettingsInterfaceUserColorsCard({
    t,
    prefs,
    onRandomUserColoursChange,
    onResetTrustColors,
    onSaveTrustColor,
    onTrustColorDraftChange
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    {t('view.settings.appearance.user_colors.header')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
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
                <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">
                            {t('view.settings.appearance.user_colors.header')}
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onResetTrustColors}
                        >
                            {t('dialog.shared_feed_filters.reset')}
                        </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {TRUST_COLOR_ENTRIES.map((entry) => (
                            <div
                                key={entry.key}
                                className="flex flex-col gap-2 rounded-md border p-3"
                            >
                                <div className={entry.className}>
                                    {t(entry.labelKey)}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {entry.presets.map((preset) => (
                                        <Button
                                            key={preset}
                                            type="button"
                                            variant="outline"
                                            size="icon-sm"
                                            className="size-6 p-0"
                                            style={{
                                                backgroundColor: preset
                                            }}
                                            aria-label={preset}
                                            onClick={() =>
                                                onSaveTrustColor(
                                                    entry.key,
                                                    preset
                                                )
                                            }
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="color"
                                        className="h-8 w-12 p-1"
                                        value={
                                            isValidTrustColor(
                                                prefs.trustColor?.[entry.key]
                                            )
                                                ? prefs.trustColor[entry.key]
                                                : TRUST_COLOR_DEFAULTS[
                                                      entry.key
                                                  ]
                                        }
                                        onChange={(event) =>
                                            onSaveTrustColor(
                                                entry.key,
                                                event.target.value
                                            )
                                        }
                                    />
                                    <Input
                                        value={
                                            prefs.trustColor?.[entry.key] ||
                                            TRUST_COLOR_DEFAULTS[entry.key]
                                        }
                                        onChange={(event) =>
                                            onTrustColorDraftChange(
                                                entry.key,
                                                event.target.value
                                            )
                                        }
                                        onBlur={(event) =>
                                            onSaveTrustColor(
                                                entry.key,
                                                event.target.value
                                            )
                                        }
                                        className="font-mono"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
