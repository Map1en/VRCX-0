import type { TFunction } from 'i18next';
import { ChevronDownIcon, Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getLanguageName, languageCodes } from '@/localization/index';
import { supportsConfigurableCjkFontPack } from '@/services/themeService';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_CJK_FONT_PACKS,
    APP_FONT_DEFAULT_KEY,
    APP_FONT_FAMILIES
} from '@/shared/constants/fonts';
import type { TableDensity } from '@/state/shellStore';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { SettingsCard } from '../SettingsCard';
import { Field, SegmentedPreference } from '../SettingsField';

type FontPreferencePrefs = {
    appFontFamily: string;
    appCjkFontPack: string;
    customFontFamily?: string;
    customFontPrimary?: string;
    customFontSecondary?: string;
    customFontOverride?: string;
};

type AppearancePrefs = FontPreferencePrefs & {
    tableDensity: string;
    dataTableStriped: boolean;
    reducedMotionAndBlur: boolean;
    accessibleStatusIndicators: boolean;
};

type SettingsInterfaceAppearanceCardProps = {
    locale: string;
    prefs: AppearancePrefs;
    zoomInput: string;
    hideFontControls: boolean;
    onLanguageChange: (value: string | null) => void;
    onFontFamilyChange: (value: string) => void;
    onCjkFontPackChange: (value: string) => void;
    onZoomInputChange: (value: string) => void;
    onZoomBlur: (value: string) => void;
    onTableDensityChange: (value: TableDensity) => void;
    onDataTableStripedChange: (value: boolean) => void;
    onAccessibleStatusIndicatorsChange: (value: boolean) => void;
    onReducedMotionAndBlurChange: (value: boolean) => void;
};

const fontFamilyNames: Record<string, string> = {
    inter: 'Inter',
    noto_sans: 'Noto Sans',
    nunito_sans: 'Nunito Sans',
    ibm_plex_sans: 'IBM Plex Sans',
    jetbrains_mono: 'JetBrains Mono',
    fantasque_sans_mono: 'Fantasque Sans Mono'
};

const cjkFontPackNames: Record<string, string> = {
    noto: 'Noto Sans CJK',
    puhuiti: 'PuHuiTi CJK'
};

const westernFontDropdownOptions = APP_FONT_FAMILIES.filter(
    (value) => value !== 'custom' && value !== 'system_ui'
);

const cjkFontPackOptions = APP_CJK_FONT_PACKS;

function getFontFamilyLabel(t: TFunction, value: string) {
    const fixedName = fontFamilyNames[value];
    if (fixedName) {
        return fixedName;
    }
    if (value === 'system_ui') {
        return t('view.settings.appearance.appearance.font_family_system_ui');
    }
    if (value === 'custom') {
        return t('view.settings.appearance.appearance.font_family_custom');
    }
    return t('view.settings.appearance.appearance.font_family_geist');
}

function getCjkFontPackLabel(t: TFunction, value: string) {
    return (
        cjkFontPackNames[value] ||
        t('view.settings.appearance.appearance.font_family_system_ui')
    );
}

function getCustomFontDisplayText(t: TFunction, prefs: FontPreferencePrefs) {
    const override = (prefs.customFontOverride ?? '').trim();
    if (override) {
        return override;
    }

    const selectedFonts = [
        (prefs.customFontPrimary ?? '').trim(),
        (prefs.customFontSecondary ?? '').trim()
    ].filter(Boolean);
    if (selectedFonts.length) {
        return selectedFonts.join(' / ');
    }

    return (
        (prefs.customFontFamily ?? '').trim() ||
        t('view.settings.appearance.appearance.font_family_custom')
    );
}

function getFontDropdownDisplayText(
    t: TFunction,
    prefs: FontPreferencePrefs,
    showCjkFontPack: boolean
) {
    if (prefs.appFontFamily === 'custom') {
        return getCustomFontDisplayText(t, prefs);
    }

    const fontLabel = getFontFamilyLabel(
        t,
        prefs.appFontFamily || APP_FONT_DEFAULT_KEY
    );
    if (!showCjkFontPack) {
        return fontLabel;
    }

    const cjkLabel = getCjkFontPackLabel(
        t,
        prefs.appCjkFontPack || APP_CJK_FONT_PACK_DEFAULT_KEY
    );
    return `${fontLabel} / ${cjkLabel}`;
}

function FontFamilyPreferenceField({
    locale,
    prefs,
    onFontFamilyChange,
    onCjkFontPackChange
}: {
    locale: string;
    prefs: FontPreferencePrefs;
    onFontFamilyChange: (value: string) => void;
    onCjkFontPackChange: (value: string) => void;
}) {
    const { t } = useTranslation();
    const showCjkFontPack = supportsConfigurableCjkFontPack(locale);
    const customActive = prefs.appFontFamily === 'custom';

    return (
        <Field
            settingId="interface.appearance.font-family"
            label={t('view.settings.appearance.appearance.font_family')}
            description={t(
                'view.settings.appearance.appearance.font_family_description'
            )}
            className="lg:grid-cols-[minmax(0,1fr)_320px]"
        >
            <div className="flex w-full items-center gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-w-0 flex-1 justify-between font-normal"
                            >
                                <span className="truncate">
                                    {getFontDropdownDisplayText(
                                        t,
                                        prefs,
                                        showCjkFontPack
                                    )}
                                </span>
                                <ChevronDownIcon
                                    data-icon="inline-end"
                                    className="opacity-50"
                                />
                            </Button>
                        }
                    />
                    <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                            <DropdownMenuRadioGroup
                                value={customActive ? '' : prefs.appFontFamily}
                                onValueChange={onFontFamilyChange}
                            >
                                {westernFontDropdownOptions.map((value) => (
                                    <DropdownMenuRadioItem
                                        key={value}
                                        value={value}
                                    >
                                        {getFontFamilyLabel(t, value)}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuGroup>
                        {showCjkFontPack && !customActive ? (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuRadioGroup
                                        value={prefs.appCjkFontPack}
                                        onValueChange={onCjkFontPackChange}
                                    >
                                        {cjkFontPackOptions.map((value) => (
                                            <DropdownMenuRadioItem
                                                key={value}
                                                value={value}
                                            >
                                                {getCjkFontPackLabel(t, value)}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuGroup>
                            </>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button
                    type="button"
                    variant={customActive ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => onFontFamilyChange('custom')}
                >
                    <Settings2Icon data-icon="inline-start" />
                    {t(
                        'view.settings.appearance.appearance.font_family_custom'
                    )}
                </Button>
            </div>
        </Field>
    );
}

export function SettingsInterfaceAppearanceCard({
    locale,
    prefs,
    zoomInput,
    hideFontControls,
    onLanguageChange,
    onFontFamilyChange,
    onCjkFontPackChange,
    onZoomInputChange,
    onZoomBlur,
    onTableDensityChange,
    onDataTableStripedChange,
    onAccessibleStatusIndicatorsChange,
    onReducedMotionAndBlurChange
}: SettingsInterfaceAppearanceCardProps) {
    const { t } = useTranslation();

    return (
        <SettingsCard
            cardId="interface.appearance"
            title={t('view.settings.appearance.appearance.header')}
        >
            <Field
                settingId="interface.appearance.language"
                label={t('view.settings.appearance.appearance.language')}
                controlId="settings-language"
            >
                <Select value={locale || 'en'} onValueChange={onLanguageChange}>
                    <SelectTrigger id="settings-language" className="w-56">
                        <SelectValue>
                            {getLanguageName(locale || 'en')}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {languageCodes.map((code) => (
                                <SelectItem key={code} value={code}>
                                    {getLanguageName(code)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>

            {!hideFontControls ? (
                <FontFamilyPreferenceField
                    locale={locale}
                    prefs={prefs}
                    onFontFamilyChange={onFontFamilyChange}
                    onCjkFontPackChange={onCjkFontPackChange}
                />
            ) : null}

            <Field
                settingId="interface.appearance.zoom"
                label={t('view.settings.appearance.appearance.zoom')}
                controlId="settings-zoom"
            >
                <div className="flex items-center gap-2">
                    <NumberField
                        id="settings-zoom"
                        name="zoom"
                        min={30}
                        max={300}
                        step={1}
                        allowOutOfRange
                        className="w-36"
                        value={zoomInput === '' ? null : Number(zoomInput)}
                        onValueChange={(value) =>
                            onZoomInputChange(
                                value === null ? '' : String(value)
                            )
                        }
                        onValueCommitted={(value) =>
                            onZoomBlur(value === null ? '' : String(value))
                        }
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
                </div>
            </Field>

            <Field
                settingId="interface.appearance.table-density"
                onReset={() =>
                    onTableDensityChange(SETTINGS_DEFAULT_VALUES.tableDensity)
                }
                label={t('view.settings.appearance.appearance.table_density')}
            >
                <SegmentedPreference
                    value={prefs.tableDensity || 'standard'}
                    onChange={(value) => {
                        if (value === 'standard' || value === 'compact') {
                            onTableDensityChange(value);
                        }
                    }}
                    options={[
                        {
                            value: 'standard',
                            label: t(
                                'view.settings.appearance.appearance.table_density_standard'
                            )
                        },
                        {
                            value: 'compact',
                            label: t(
                                'view.settings.appearance.appearance.table_density_compact'
                            )
                        }
                    ]}
                />
            </Field>

            <Field
                settingId="interface.appearance.striped-tables"
                onReset={() =>
                    onDataTableStripedChange(
                        SETTINGS_DEFAULT_VALUES.dataTableStriped
                    )
                }
                label={t(
                    'view.settings.appearance.appearance.striped_data_table_mode'
                )}
            >
                <Switch
                    checked={prefs.dataTableStriped}
                    onCheckedChange={onDataTableStripedChange}
                />
            </Field>

            <Field
                settingId="interface.appearance.reduced-motion"
                onReset={() =>
                    onReducedMotionAndBlurChange(
                        SETTINGS_DEFAULT_VALUES.reducedMotionAndBlur
                    )
                }
                label={t(
                    'view.settings.appearance.appearance.reduced_motion_and_blur'
                )}
                description={t(
                    'view.settings.appearance.appearance.reduced_motion_and_blur_description'
                )}
            >
                <Switch
                    checked={prefs.reducedMotionAndBlur}
                    onCheckedChange={onReducedMotionAndBlurChange}
                />
            </Field>

            <Field
                settingId="interface.appearance.accessible-status"
                onReset={() =>
                    onAccessibleStatusIndicatorsChange(
                        SETTINGS_DEFAULT_VALUES.accessibleStatusIndicators
                    )
                }
                label={t(
                    'view.settings.appearance.appearance.accessible_status_indicators'
                )}
                description={t(
                    'view.settings.appearance.appearance.accessible_status_indicators_description'
                )}
            >
                <Switch
                    checked={prefs.accessibleStatusIndicators}
                    onCheckedChange={onAccessibleStatusIndicatorsChange}
                />
            </Field>
        </SettingsCard>
    );
}
