import { CodeXmlIcon, SearchIcon, TypeIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    composeCustomFontFamily,
    createEffectiveCustomFontDraft,
    quoteCssFontFamilyName,
    type CustomFontDraft,
    type CustomFontMode
} from '@/features/settings/settingsValues';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList
} from '@/ui/shadcn/combobox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldTitle
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { InputGroupAddon } from '@/ui/shadcn/input-group';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

type FontFamilyComboboxProps = {
    controlId: string;
    label: string;
    description: string;
    placeholder: string;
    emptyLabel: string;
    value: string;
    options: readonly string[];
    loading: boolean;
    allowClear: boolean;
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

function FontFamilyCombobox({
    controlId,
    label,
    description,
    placeholder,
    emptyLabel,
    value,
    options,
    loading,
    allowClear,
    onChange
}: FontFamilyComboboxProps) {
    return (
        <Field>
            <FieldContent>
                <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
                <FieldDescription>{description}</FieldDescription>
            </FieldContent>
            {loading ? (
                <Skeleton className="h-8 w-full" />
            ) : (
                <Combobox
                    items={options}
                    value={value || null}
                    autoHighlight
                    onValueChange={(nextValue: string | null) =>
                        onChange(nextValue ?? '')
                    }
                >
                    <ComboboxInput
                        id={controlId}
                        className="w-full"
                        placeholder={placeholder}
                        showClear={allowClear && Boolean(value)}
                    >
                        <InputGroupAddon align="inline-start">
                            <SearchIcon />
                        </InputGroupAddon>
                    </ComboboxInput>
                    <ComboboxContent>
                        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
                        <ComboboxList>
                            {(font: string) => (
                                <ComboboxItem key={font} value={font}>
                                    <span className="min-w-0 flex-1 truncate">
                                        {font}
                                    </span>
                                    <span
                                        className="text-muted-foreground shrink-0"
                                        style={{
                                            fontFamily: `${quoteCssFontFamilyName(font)}, system-ui`
                                        }}
                                        aria-hidden="true"
                                    >
                                        Aa 中 あ 한
                                    </span>
                                </ComboboxItem>
                            )}
                        </ComboboxList>
                    </ComboboxContent>
                </Combobox>
            )}
        </Field>
    );
}

export function CustomFontDialog({
    open,
    onOpenChange,
    draft: draftValue,
    onDraftChange,
    fontOptions = [],
    fontOptionsLoading = false,
    onSave
}: CustomFontDialogProps) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<CustomFontMode>('installed');
    const modeInitializedRef = useRef(false);
    const draft = normalizeDraft(draftValue);
    const options = Array.isArray(fontOptions) ? fontOptions : [];
    const noDetectedFonts = !fontOptionsLoading && options.length === 0;
    const installedModeUnavailable = noDetectedFonts && !draft.primary.trim();
    const effectiveDraft = createEffectiveCustomFontDraft(draft, mode);
    const effectiveFontFamily = composeCustomFontFamily(effectiveDraft);
    const saveDisabled =
        mode === 'installed'
            ? !effectiveDraft.primary
            : !effectiveDraft.override;

    useEffect(() => {
        if (!open) {
            modeInitializedRef.current = false;
            return;
        }
        if (!modeInitializedRef.current) {
            modeInitializedRef.current = true;
            setMode(
                draft.override.trim() || installedModeUnavailable
                    ? 'css'
                    : 'installed'
            );
            return;
        }
        if (installedModeUnavailable) {
            setMode('css');
        }
    }, [open, draft.override, installedModeUnavailable]);

    function updateDraft(patch: Partial<CustomFontDraft>) {
        onDraftChange({
            ...draft,
            ...patch
        });
    }

    function handleModeChange(nextValue: readonly string[]) {
        const nextMode = nextValue[0];
        if (nextMode === 'installed' || nextMode === 'css') {
            setMode(nextMode);
        }
    }

    function handleSave() {
        if (!saveDisabled) {
            onSave(effectiveDraft);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="grid max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
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
                        <Field>
                            <FieldTitle>
                                {t(
                                    'view.settings.appearance.appearance.font_family_custom_mode_label'
                                )}
                            </FieldTitle>
                            <ToggleGroup
                                variant="outline"
                                value={[mode]}
                                onValueChange={handleModeChange}
                                className="grid w-full grid-cols-2"
                            >
                                <ToggleGroupItem
                                    value="installed"
                                    disabled={installedModeUnavailable}
                                >
                                    <TypeIcon data-icon="inline-start" />
                                    {t(
                                        'view.settings.appearance.appearance.font_family_custom_mode_installed'
                                    )}
                                </ToggleGroupItem>
                                <ToggleGroupItem value="css">
                                    <CodeXmlIcon data-icon="inline-start" />
                                    {t(
                                        'view.settings.appearance.appearance.font_family_custom_mode_css'
                                    )}
                                </ToggleGroupItem>
                            </ToggleGroup>
                        </Field>

                        {noDetectedFonts ? (
                            <Alert>
                                <AlertTitle>
                                    {t(
                                        'view.settings.appearance.appearance.font_family_custom_detection_unavailable_title'
                                    )}
                                </AlertTitle>
                                <AlertDescription>
                                    {t(
                                        'view.settings.appearance.appearance.font_family_custom_detection_unavailable'
                                    )}
                                </AlertDescription>
                            </Alert>
                        ) : null}

                        {mode === 'installed' ? (
                            <FieldGroup className="gap-4">
                                <FontFamilyCombobox
                                    controlId="settings-custom-font-primary"
                                    label={t(
                                        'view.settings.appearance.appearance.font_family_custom_primary'
                                    )}
                                    description={t(
                                        'view.settings.appearance.appearance.font_family_custom_primary_description'
                                    )}
                                    placeholder={t(
                                        'view.settings.appearance.appearance.font_family_custom_search_placeholder'
                                    )}
                                    emptyLabel={t(
                                        'view.settings.appearance.appearance.font_family_custom_no_results'
                                    )}
                                    value={draft.primary}
                                    options={options}
                                    loading={
                                        fontOptionsLoading && !options.length
                                    }
                                    allowClear={false}
                                    onChange={(value) =>
                                        updateDraft({ primary: value })
                                    }
                                />
                                <FontFamilyCombobox
                                    controlId="settings-custom-font-secondary"
                                    label={t(
                                        'view.settings.appearance.appearance.font_family_custom_secondary'
                                    )}
                                    description={t(
                                        'view.settings.appearance.appearance.font_family_custom_secondary_description'
                                    )}
                                    placeholder={t(
                                        'view.settings.appearance.appearance.font_family_custom_search_optional_placeholder'
                                    )}
                                    emptyLabel={t(
                                        'view.settings.appearance.appearance.font_family_custom_no_results'
                                    )}
                                    value={draft.secondary}
                                    options={options}
                                    loading={
                                        fontOptionsLoading && !options.length
                                    }
                                    allowClear
                                    onChange={(value) =>
                                        updateDraft({ secondary: value })
                                    }
                                />
                            </FieldGroup>
                        ) : (
                            <Field>
                                <FieldContent>
                                    <FieldLabel htmlFor="settings-custom-font-override">
                                        {t(
                                            'view.settings.appearance.appearance.font_family_custom_override'
                                        )}
                                    </FieldLabel>
                                    <FieldDescription>
                                        {t(
                                            'view.settings.appearance.appearance.font_family_custom_override_description'
                                        )}
                                    </FieldDescription>
                                </FieldContent>
                                <Input
                                    id="settings-custom-font-override"
                                    value={draft.override}
                                    name="customFontOverride"
                                    placeholder={t(
                                        'view.settings.appearance.appearance.font_family_custom_override_placeholder'
                                    )}
                                    onChange={(event) =>
                                        updateDraft({
                                            override: event.target.value
                                        })
                                    }
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            handleSave();
                                        }
                                    }}
                                />
                                <FieldDescription>
                                    {t(
                                        'view.settings.appearance.appearance.font_family_custom_override_hint'
                                    )}
                                </FieldDescription>
                            </Field>
                        )}

                        <Field>
                            <FieldTitle>
                                {t(
                                    'view.settings.appearance.appearance.font_family_custom_preview'
                                )}
                            </FieldTitle>
                            <div className="bg-muted/30 rounded-lg border p-4">
                                <p
                                    className="text-base leading-relaxed"
                                    style={{
                                        fontFamily:
                                            effectiveFontFamily || 'system-ui'
                                    }}
                                >
                                    {t(
                                        'view.settings.appearance.appearance.font_family_custom_preview_sample'
                                    )}
                                </p>
                            </div>
                        </Field>
                    </FieldGroup>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.alertdialog.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saveDisabled}
                        onClick={handleSave}
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
