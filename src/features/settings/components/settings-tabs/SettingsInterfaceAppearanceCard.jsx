import { ChevronDownIcon } from 'lucide-react';

import { getLanguageName, languageCodes } from '@/localization/index.js';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_CJK_FONT_PACKS,
    APP_FONT_DEFAULT_KEY,
    APP_FONT_FAMILIES,
    formatZoomPercentage
} from '@/services/themeService.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField.jsx';

const fontFamilyLabelKeys = {
    inter: 'view.settings.appearance.appearance.font_family_inter',
    noto_sans: 'view.settings.appearance.appearance.font_family_noto_sans',
    geist: 'view.settings.appearance.appearance.font_family_geist',
    nunito_sans: 'view.settings.appearance.appearance.font_family_nunito_sans',
    ibm_plex_sans:
        'view.settings.appearance.appearance.font_family_ibm_plex_sans',
    jetbrains_mono:
        'view.settings.appearance.appearance.font_family_jetbrains_mono',
    fantasque_sans_mono:
        'view.settings.appearance.appearance.font_family_fantasque_sans_mono',
    system_ui: 'view.settings.appearance.appearance.font_family_system_ui',
    custom: 'view.settings.appearance.appearance.font_family_custom'
};

const cjkFontPackLabelKeys = {
    noto: 'view.settings.appearance.appearance.cjk_font_pack_noto',
    puhuiti: 'view.settings.appearance.appearance.cjk_font_pack_puhuiti',
    system: 'view.settings.appearance.appearance.font_family_system_ui'
};

const westernFontDropdownOptions = APP_FONT_FAMILIES.map((value) => [
    value,
    fontFamilyLabelKeys[value]
]).filter(([value]) => value !== 'custom' && value !== 'system_ui');

const cjkFontPackOptions = APP_CJK_FONT_PACKS.map((value) => [
    value,
    cjkFontPackLabelKeys[value]
]);

function getFontDropdownDisplayText(t, prefs) {
    if (prefs.appFontFamily === 'custom') {
        return t('view.settings.appearance.appearance.font_family_custom');
    }

    const fontLabel =
        fontFamilyLabelKeys[prefs.appFontFamily] ||
        fontFamilyLabelKeys[APP_FONT_DEFAULT_KEY];
    const cjkLabel =
        cjkFontPackLabelKeys[prefs.appCjkFontPack] ||
        cjkFontPackLabelKeys[APP_CJK_FONT_PACK_DEFAULT_KEY];
    return `${t(fontLabel)} / ${t(cjkLabel)}`;
}

export function SettingsInterfaceAppearanceCard({
    t,
    locale,
    prefs,
    zoomInput,
    zoomLevel,
    onLanguageChange,
    onFontFamilyChange,
    onCjkFontPackChange,
    onZoomInputChange,
    onZoomBlur,
    onNotificationIconDotChange,
    onDataTableStripedChange,
    onPointerOnHoverChange,
    onAccessibleStatusIndicatorsChange
}) {
    const fontDropdownDisplayText = getFontDropdownDisplayText(t, prefs);

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    {t('view.settings.appearance.appearance.header')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
                <Field
                    label={t('view.settings.appearance.appearance.language')}
                    controlId="settings-language"
                >
                    <Select
                        value={locale || 'en'}
                        onValueChange={onLanguageChange}
                    >
                        <SelectTrigger
                            id="settings-language"
                            className="w-56"
                        >
                            <SelectValue />
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

                <Field
                    label={t('view.settings.appearance.appearance.font_family')}
                >
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-w-44 justify-between font-normal"
                            >
                                <span className="truncate">
                                    {fontDropdownDisplayText}
                                </span>
                                <ChevronDownIcon
                                    data-icon="inline-end"
                                    className="opacity-50"
                                />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                                <DropdownMenuRadioGroup
                                    value={prefs.appFontFamily}
                                    onValueChange={onFontFamilyChange}
                                >
                                    {westernFontDropdownOptions.map(
                                        ([value, labelKey]) => (
                                            <DropdownMenuRadioItem
                                                key={value}
                                                value={value}
                                            >
                                                {t(labelKey)}
                                            </DropdownMenuRadioItem>
                                        )
                                    )}
                                    <DropdownMenuRadioItem value="custom">
                                        {t(
                                            'view.settings.appearance.appearance.font_family_custom'
                                        )}
                                    </DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuRadioGroup
                                    value={
                                        prefs.appFontFamily === 'custom'
                                            ? ''
                                            : prefs.appCjkFontPack
                                    }
                                    onValueChange={onCjkFontPackChange}
                                >
                                    {cjkFontPackOptions.map(
                                        ([value, labelKey]) => (
                                            <DropdownMenuRadioItem
                                                key={value}
                                                value={value}
                                            >
                                                {t(labelKey)}
                                            </DropdownMenuRadioItem>
                                        )
                                    )}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </Field>

                <Field
                    label={t('view.settings.appearance.appearance.zoom')}
                    controlId="settings-zoom"
                >
                    <div className="flex items-center gap-2">
                        <Input
                            id="settings-zoom"
                            name="zoom"
                            inputMode="numeric"
                            type="number"
                            min={30}
                            max={300}
                            step={1}
                            className="w-28"
                            value={zoomInput}
                            onChange={(event) =>
                                onZoomInputChange(event.target.value)
                            }
                            onBlur={onZoomBlur}
                        />
                        <Badge variant="outline">
                            {formatZoomPercentage(zoomLevel)}
                        </Badge>
                    </div>
                </Field>

                <Field
                    label={t(
                        'view.settings.appearance.appearance.show_notification_icon_dot'
                    )}
                >
                    <Switch
                        checked={prefs.notificationIconDot}
                        onCheckedChange={onNotificationIconDotChange}
                    />
                </Field>

                <Field
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
                    label={t(
                        'view.settings.appearance.appearance.toggle_pointer_on_hover'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.toggle_pointer_on_hover_description'
                    )}
                >
                    <Switch
                        checked={prefs.showPointerOnHover}
                        onCheckedChange={onPointerOnHoverChange}
                    />
                </Field>

                <Field
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
            </CardContent>
        </Card>
    );
}
