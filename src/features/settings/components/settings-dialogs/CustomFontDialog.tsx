import { ChevronRightIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    composeCustomFontFamily,
    quoteCssFontFamilyName,
    type CustomFontDraft
} from '@/features/settings/settingsValues';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { Field, FieldDescription, FieldGroup } from '../SettingsField';

type FontFamilySelectorProps = {
    controlId: string;
    label: string;
    description: string;
    value: string;
    options: readonly string[];
    disabled: boolean;
    loading: boolean;
    clearLabel: string;
    onChange: (value: string) => void;
};

type CustomFontDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    draft: Partial<CustomFontDraft> | null | undefined;
    onDraftChange: (draft: CustomFontDraft) => void;
    fontOptions?: string[];
    fontOptionsLoading?: boolean;
    onSave: (draft: CustomFontDraft) => void | Promise<void>;
};

function normalizeDraft(
    value: Partial<CustomFontDraft> | null | undefined
): CustomFontDraft {
    return {
        primary: String(value?.primary ?? ''),
        secondary: String(value?.secondary ?? ''),
        override: String(value?.override ?? '')
    };
}

function FontFamilySelector({
    controlId,
    label,
    description,
    value,
    options,
    disabled,
    loading,
    clearLabel,
    onChange
}: FontFamilySelectorProps) {
    return (
        <Field
            label={label}
            description={description}
            controlId={controlId}
            disabled={disabled}
            controlClassName="lg:justify-start"
        >
            <div className="w-full">
                {loading ? (
                    <Skeleton className="h-8 w-full" />
                ) : (
                    <div className="flex w-full items-center gap-2">
                        <Select
                            value={value || ''}
                            disabled={disabled}
                            onValueChange={(nextValue: string) => {
                                onChange(nextValue);
                            }}
                        >
                            <SelectTrigger
                                id={controlId}
                                className="min-w-0 flex-1"
                            >
                                <SelectValue placeholder={label} />
                            </SelectTrigger>
                            <SelectContent className="max-h-64">
                                <SelectGroup>
                                    {options.map((font) => (
                                        <SelectItem
                                            key={font}
                                            value={font}
                                            style={{
                                                fontFamily: `${quoteCssFontFamilyName(font)}, system-ui`
                                            }}
                                        >
                                            <span className="truncate">
                                                {font}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={disabled || !value}
                            onClick={() => onChange('')}
                            aria-label={clearLabel}
                        >
                            <XIcon data-icon="inline-start" />
                            <span className="sr-only">{clearLabel}</span>
                        </Button>
                    </div>
                )}
            </div>
        </Field>
    );
}

export function CustomFontDialog({
    open: customFontDialogOpen,
    onOpenChange: setCustomFontDialogOpen,
    draft: customFontDraft,
    onDraftChange: setCustomFontDraft,
    fontOptions = [],
    fontOptionsLoading = false,
    onSave: saveCustomFontFamily
}: CustomFontDialogProps) {
    const { t } = useTranslation();
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const advancedInitializedRef = useRef(false);
    const draft = normalizeDraft(customFontDraft);
    const hasOverrideText = Boolean(draft.override.trim());
    const effectiveOverride = advancedOpen ? draft.override : '';
    const overrideActive = Boolean(effectiveOverride.trim());
    const effectiveDraft = { ...draft, override: effectiveOverride };
    const options = Array.isArray(fontOptions) ? fontOptions : [];
    const noDetectedFonts = !fontOptionsLoading && options.length === 0;
    const selectorsDisabled =
        overrideActive ||
        noDetectedFonts ||
        (fontOptionsLoading && !options.length);
    const effectiveFontFamily = useMemo(
        () => composeCustomFontFamily(effectiveDraft),
        [draft.primary, draft.secondary, effectiveOverride]
    );
    const saveDisabled = !effectiveFontFamily;

    useEffect(() => {
        if (!customFontDialogOpen) {
            advancedInitializedRef.current = false;
            return;
        }
        if (!advancedInitializedRef.current) {
            advancedInitializedRef.current = true;
            setAdvancedOpen(hasOverrideText);
        }
        if (noDetectedFonts) {
            setAdvancedOpen(true);
        }
    }, [customFontDialogOpen, noDetectedFonts, hasOverrideText]);

    function updateDraft(patch: Partial<CustomFontDraft>) {
        setCustomFontDraft({
            ...draft,
            ...patch
        });
    }

    function handleSave() {
        if (!saveDisabled) {
            saveCustomFontFamily(effectiveDraft);
        }
    }

    return (
        <Dialog
            open={customFontDialogOpen}
            onOpenChange={setCustomFontDialogOpen}
        >
            <DialogContent className="grid max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.appearance.appearance.font_family_custom_dialog_title'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.appearance.appearance.font_family_custom_dialog_description'
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 overflow-y-auto pr-1">
                    <FieldGroup>
                        <FontFamilySelector
                            controlId="settings-custom-font-primary"
                            label={t(
                                'view.settings.appearance.appearance.font_family_custom_primary'
                            )}
                            description={t(
                                'view.settings.appearance.appearance.font_family_custom_primary_description'
                            )}
                            value={draft.primary}
                            options={options}
                            disabled={selectorsDisabled}
                            loading={fontOptionsLoading && !options.length}
                            clearLabel={t('common.actions.clear')}
                            onChange={(value: string) =>
                                updateDraft({ primary: value })
                            }
                        />
                        <FontFamilySelector
                            controlId="settings-custom-font-secondary"
                            label={t(
                                'view.settings.appearance.appearance.font_family_custom_secondary'
                            )}
                            description={t(
                                'view.settings.appearance.appearance.font_family_custom_secondary_description'
                            )}
                            value={draft.secondary}
                            options={options}
                            disabled={selectorsDisabled}
                            loading={fontOptionsLoading && !options.length}
                            clearLabel={t('common.actions.clear')}
                            onChange={(value: string) =>
                                updateDraft({ secondary: value })
                            }
                        />
                    </FieldGroup>

                    {overrideActive ? (
                        <p className="text-muted-foreground mt-2 text-sm">
                            {t(
                                'view.settings.appearance.appearance.font_family_custom_override_active'
                            )}
                        </p>
                    ) : null}
                    {noDetectedFonts ? (
                        <p className="text-muted-foreground mt-2 text-sm">
                            {t(
                                'view.settings.appearance.appearance.font_family_custom_detection_unavailable'
                            )}
                        </p>
                    ) : null}

                    <div className="bg-muted/30 mt-4 rounded-md border p-3">
                        <div className="text-muted-foreground mb-1 text-xs font-medium">
                            {t(
                                'view.settings.appearance.appearance.font_family_custom_preview'
                            )}
                        </div>
                        <div
                            className="text-sm"
                            style={{
                                fontFamily: effectiveFontFamily || 'system-ui'
                            }}
                        >
                            {t(
                                'view.settings.appearance.appearance.font_family_custom_preview_sample'
                            )}
                        </div>
                    </div>

                    <Collapsible
                        open={advancedOpen}
                        onOpenChange={setAdvancedOpen}
                        className="mt-4"
                    >
                        <CollapsibleTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="px-0"
                            >
                                <ChevronRightIcon
                                    className={advancedOpen ? 'rotate-90' : ''}
                                />
                                {t(
                                    'view.settings.appearance.appearance.font_family_custom_advanced'
                                )}
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                            <Field
                                label={t(
                                    'view.settings.appearance.appearance.font_family_custom_override'
                                )}
                                description={t(
                                    'view.settings.appearance.appearance.font_family_custom_override_description'
                                )}
                                controlId="settings-custom-font-override"
                                controlClassName="lg:justify-start"
                            >
                                <Input
                                    id="settings-custom-font-override"
                                    value={draft.override}
                                    name="customFontOverride"
                                    placeholder={t(
                                        'view.settings.appearance.appearance.font_family_custom_override_placeholder'
                                    )}
                                    onChange={(event: any) =>
                                        updateDraft({
                                            override: event.target.value
                                        })
                                    }
                                    onKeyDown={(event: any) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            handleSave();
                                        }
                                    }}
                                />
                            </Field>
                            <FieldDescription className="mt-2">
                                {t(
                                    'view.settings.appearance.appearance.font_family_custom_override_hint'
                                )}
                            </FieldDescription>
                        </CollapsibleContent>
                    </Collapsible>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCustomFontDialogOpen(false)}
                    >
                        {t('dialog.alertdialog.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saveDisabled}
                        onClick={handleSave}
                    >
                        {t('dialog.alertdialog.ok')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
