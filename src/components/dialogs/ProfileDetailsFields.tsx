import { PlusIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PROFILE_LIST_LIMIT } from '@/shared/constants/profileLimits';
import {
    languageOptionLabel,
    normalizeProfileLanguageKeys
} from '@/shared/utils/userLanguage';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxChip,
    ComboboxChips,
    ComboboxChipsInput,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxItem,
    ComboboxList,
    ComboboxValue,
    useComboboxAnchor
} from '@/ui/shadcn/combobox';
import { Field, FieldDescription, FieldLabel } from '@/ui/shadcn/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';

type LanguageOption = { key: string; value: string };

export function ProfileLanguagesField({
    languageRows,
    availableLanguageOptions,
    languageOptionsStatus,
    busy,
    onChange
}: {
    languageRows: LanguageOption[];
    availableLanguageOptions: LanguageOption[];
    languageOptionsStatus: string;
    busy: boolean;
    onChange: (languageKeys: string[]) => void;
}) {
    const { t } = useTranslation();
    const languageComboboxAnchor = useComboboxAnchor();
    const selectedLanguageKeys = languageRows.map((language) => language.key);
    const languageLabelByKey = new Map(
        [...languageRows, ...availableLanguageOptions].map((language) => [
            language.key,
            languageOptionLabel(language)
        ])
    );
    const selectableLanguageKeys =
        selectedLanguageKeys.length >= PROFILE_LIST_LIMIT
            ? []
            : availableLanguageOptions.map((option) => option.key);
    const languageInputDisabled =
        busy ||
        languageOptionsStatus === 'running' ||
        selectedLanguageKeys.length >= PROFILE_LIST_LIMIT ||
        !availableLanguageOptions.length;
    const languageInputPlaceholder =
        languageOptionsStatus === 'running'
            ? t('dialog.user.loading.loading_languages')
            : t('dialog.user.action.select_language');

    return (
        <Field>
            <div className="flex items-center justify-between gap-2">
                <FieldLabel>{t('dialog.user.label.languages')}</FieldLabel>
                <span className="text-muted-foreground text-xs tabular-nums">
                    {languageRows.length}/{PROFILE_LIST_LIMIT}
                </span>
            </div>
            <Combobox
                multiple
                autoHighlight
                items={selectableLanguageKeys}
                value={selectedLanguageKeys}
                itemToStringLabel={(key) => languageLabelByKey.get(key) || key}
                onValueChange={(values: string[]) =>
                    onChange(normalizeProfileLanguageKeys(values))
                }
            >
                <ComboboxChips ref={languageComboboxAnchor} className="w-full">
                    <ComboboxValue>
                        {(values: string[]) => (
                            <>
                                {values.map((value) => (
                                    <ComboboxChip
                                        key={value}
                                        showRemove={!busy}
                                    >
                                        <span className="max-w-36 truncate">
                                            {languageLabelByKey.get(value) ||
                                                value}
                                        </span>
                                    </ComboboxChip>
                                ))}
                                <ComboboxChipsInput
                                    disabled={languageInputDisabled}
                                    placeholder={
                                        values.length
                                            ? ''
                                            : languageInputPlaceholder
                                    }
                                    aria-label={t(
                                        'dialog.user.action.select_language'
                                    )}
                                />
                            </>
                        )}
                    </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent anchor={languageComboboxAnchor}>
                    <ComboboxEmpty>
                        {t('dialog.user.empty.no_results')}
                    </ComboboxEmpty>
                    <ComboboxList>
                        {(key) => (
                            <ComboboxItem key={key} value={key}>
                                {languageLabelByKey.get(key) || key}
                            </ComboboxItem>
                        )}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>
            {languageOptionsStatus === 'error' ? (
                <FieldDescription>
                    {t(
                        'dialog.user.label.vrchat_language_list_unavailable_using_local_language_codes'
                    )}
                </FieldDescription>
            ) : null}
        </Field>
    );
}

export function ProfileLinksField({
    label,
    addLabel,
    removeLabel,
    links,
    busy,
    onChange
}: {
    label: string;
    addLabel: string;
    removeLabel: string;
    links: string[];
    busy: boolean;
    onChange: (links: string[]) => void;
}) {
    const rows = links.length ? links : [''];

    return (
        <Field>
            <div className="flex items-center justify-between gap-2">
                <FieldLabel>{label}</FieldLabel>
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {rows.length}/{PROFILE_LIST_LIMIT}
                    </span>
                    {rows.length < PROFILE_LIST_LIMIT ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            onClick={() => onChange([...rows, ''])}
                        >
                            <PlusIcon data-icon="inline-start" />
                            {addLabel}
                        </Button>
                    ) : null}
                </div>
            </div>
            <div className="flex flex-col gap-2">
                {rows.map((link, index) => (
                    <InputGroup key={index}>
                        <InputGroupInput
                            value={link}
                            placeholder={`https://example.com/${index + 1}`}
                            maxLength={1000}
                            disabled={busy}
                            onChange={(event) => {
                                const nextLinks = [...rows];
                                nextLinks[index] = event.target.value.slice(
                                    0,
                                    1000
                                );
                                onChange(nextLinks);
                            }}
                        />
                        <InputGroupAddon align="inline-end">
                            <HintTooltip label={removeLabel}>
                                <InputGroupButton
                                    type="button"
                                    size="icon-xs"
                                    disabled={busy || rows.length <= 1}
                                    onClick={() => {
                                        const nextLinks = rows.filter(
                                            (_, linkIndex) =>
                                                linkIndex !== index
                                        );
                                        onChange(
                                            nextLinks.length ? nextLinks : ['']
                                        );
                                    }}
                                >
                                    <XIcon data-icon="inline-start" />
                                </InputGroupButton>
                            </HintTooltip>
                        </InputGroupAddon>
                    </InputGroup>
                ))}
            </div>
        </Field>
    );
}
