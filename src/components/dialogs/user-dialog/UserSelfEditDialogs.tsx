import { BookmarkIcon, HistoryIcon, PlusIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { userStatusIndicatorClassName } from '@/shared/utils/userStatus';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Separator } from '@/ui/shadcn/separator';
import { Textarea } from '@/ui/shadcn/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    languageOptionLabel,
    normalizeLanguageKey,
    normalizeSelfStatusInput
} from './userProfileFields';

function normalizeLanguageComboboxValues(values: any) {
    const nextKeys = [];
    const seen = new Set();

    for (const value of values ?? []) {
        const key = normalizeLanguageKey(value);
        if (!key || seen.has(key)) {
            continue;
        }
        nextKeys.push(key);
        seen.add(key);
        if (nextKeys.length >= 3) {
            break;
        }
    }

    return nextKeys;
}

function preventDialogOutsideClose(event: any) {
    event.preventDefault();
}

export function UserSocialStatusDialog({
    open,
    onOpenChange,
    actionStatus,
    draft,
    setDraft,
    statusHistoryRows,
    statusOptions,
    statusPresets,
    statusLabelByValue,
    onSavePreset,
    onRemovePreset,
    onCancel,
    onSave
}: any) {
    const { t } = useTranslation();

    const busy = actionStatus !== 'idle';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.user.action.edit_social_status')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.user.description.update_your_social_status_and_status_description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="user-social-status-description">
                            {t('dialog.user.description.status_description')}
                        </FieldLabel>
                        <InputGroup>
                            <InputGroupInput
                                id="user-social-status-description"
                                value={draft.statusDescription}
                                maxLength={32}
                                placeholder={t(
                                    'dialog.user.description.status_description'
                                )}
                                disabled={busy}
                                onChange={(event: any) => {
                                    setDraft((current: any) => ({
                                        ...current,
                                        statusDescription:
                                            event.target.value.slice(0, 32)
                                    }));
                                }}
                            />
                            <InputGroupAddon align="inline-end">
                                {draft.statusDescription ? (
                                    <InputGroupButton
                                        size="icon-xs"
                                        disabled={busy}
                                        aria-label={t(
                                            'dialog.user.description.clear_status_description'
                                        )}
                                        onClick={() => {
                                            setDraft((current: any) => ({
                                                ...current,
                                                statusDescription: ''
                                            }));
                                        }}
                                    >
                                        <XIcon data-icon="inline-start" />
                                    </InputGroupButton>
                                ) : null}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <InputGroupButton
                                            size="icon-xs"
                                            disabled={busy}
                                            aria-label={t(
                                                'dialog.user.label.status_history'
                                            )}
                                        >
                                            <HistoryIcon data-icon="inline-start" />
                                        </InputGroupButton>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        align="end"
                                        className="max-w-72"
                                    >
                                        <DropdownMenuGroup>
                                            {statusHistoryRows.length ? (
                                                statusHistoryRows.map(
                                                    (
                                                        status: any,
                                                        index: any
                                                    ) => (
                                                        <DropdownMenuItem
                                                            key={`${status}:${index}`}
                                                            onSelect={() => {
                                                                setDraft(
                                                                    (
                                                                        current: any
                                                                    ) => ({
                                                                        ...current,
                                                                        statusDescription:
                                                                            status.slice(
                                                                                0,
                                                                                32
                                                                            )
                                                                    })
                                                                );
                                                            }}
                                                        >
                                                            <span className="truncate">
                                                                {status}
                                                            </span>
                                                        </DropdownMenuItem>
                                                    )
                                                )
                                            ) : (
                                                <DropdownMenuItem disabled>
                                                    {t(
                                                        'dialog.user.empty.no_status_history'
                                                    )}
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </InputGroupAddon>
                        </InputGroup>
                        <FieldDescription className="text-right text-xs">
                            {draft.statusDescription.length}/32
                        </FieldDescription>
                    </Field>
                    <Field>
                        <FieldLabel>
                            {t('dialog.user.label.social_status')}
                        </FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            value={draft.status}
                            spacing={2}
                            className="w-full flex-wrap"
                            aria-label={t('dialog.user.label.social_status')}
                            onValueChange={(nextStatus: any) => {
                                if (!nextStatus) {
                                    return;
                                }
                                setDraft((current: any) => ({
                                    ...current,
                                    status: nextStatus
                                }));
                            }}
                        >
                            {statusOptions.map((option: any) => {
                                return (
                                    <ToggleGroupItem
                                        key={option.value}
                                        value={option.value}
                                        aria-label={option.label}
                                        disabled={busy}
                                        className="h-9 min-w-0 flex-1 basis-[calc(50%-0.25rem)] justify-center gap-2 px-2 sm:basis-0"
                                    >
                                        <i
                                            className={userStatusIndicatorClassName(
                                                option.value,
                                                {
                                                    showOffline: true,
                                                    className: 'shrink-0'
                                                }
                                            )}
                                        />
                                        <span className="min-w-0 truncate">
                                            {option.label}
                                        </span>
                                    </ToggleGroupItem>
                                );
                            })}
                        </ToggleGroup>
                    </Field>
                    <Field>
                        <div className="flex items-center justify-between gap-3">
                            <FieldLabel>
                                {t('dialog.social_status.presets')}
                            </FieldLabel>
                            <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                disabled={busy}
                                onClick={onSavePreset}
                            >
                                <BookmarkIcon data-icon="inline-start" />
                                {t('dialog.user.action.save_preset')}
                            </Button>
                        </div>
                        {statusPresets.length ? (
                            <div className="flex flex-wrap gap-2">
                                {statusPresets.map(
                                    (preset: any, index: any) => {
                                        const presetStatus =
                                            normalizeSelfStatusInput(
                                                preset?.status
                                            ) || 'active';
                                        const presetDescription = String(
                                            preset?.statusDescription || ''
                                        ).slice(0, 32);
                                        const label =
                                            presetDescription ||
                                            statusLabelByValue.get(
                                                presetStatus
                                            ) ||
                                            presetStatus;
                                        return (
                                            <div
                                                key={`${presetStatus}:${presetDescription}:${index}`}
                                                className="inline-flex max-w-52 items-center"
                                            >
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="xs"
                                                    className="min-w-0 justify-start rounded-r-none border-r-0"
                                                    disabled={busy}
                                                    aria-label={`Apply status preset ${label}`}
                                                    onClick={() => {
                                                        setDraft({
                                                            status: presetStatus,
                                                            statusDescription:
                                                                presetDescription
                                                        });
                                                    }}
                                                >
                                                    <i
                                                        className={userStatusIndicatorClassName(
                                                            presetStatus,
                                                            {
                                                                showOffline: true,
                                                                className:
                                                                    'shrink-0'
                                                            }
                                                        )}
                                                    />
                                                    <span className="min-w-0 truncate">
                                                        {label}
                                                    </span>
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon-xs"
                                                    className="shrink-0 rounded-l-none"
                                                    disabled={busy}
                                                    aria-label="Remove status preset"
                                                    onClick={() =>
                                                        onRemovePreset(index)
                                                    }
                                                >
                                                    <XIcon data-icon="inline-start" />
                                                </Button>
                                            </div>
                                        );
                                    }
                                )}
                            </div>
                        ) : null}
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button type="button" disabled={busy} onClick={onSave}>
                        {t('dialog.user.action.update')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function UserProfileDetailsDialog({
    open,
    onOpenChange,
    actionStatus,
    draft,
    setDraft,
    languageRows,
    availableLanguageOptions,
    languageOptionsStatus,
    onCancel,
    onSave
}: any) {
    const { t } = useTranslation();
    const languageComboboxAnchor = useComboboxAnchor();

    const busy = actionStatus !== 'idle';
    const bioLinks = draft.bioLinks?.length ? draft.bioLinks : [''];
    const bioLength = String(draft.bio || '').length;
    const pronounsLength = String(draft.pronouns || '').length;
    const selectedLanguageKeys = languageRows.map(
        (language: any) => language.key
    );
    const languageLabelByKey = new Map(
        [...languageRows, ...availableLanguageOptions].map((language: any) => [
            language.key,
            languageOptionLabel(language)
        ])
    );
    const selectableLanguageKeys =
        selectedLanguageKeys.length >= 3
            ? []
            : availableLanguageOptions.map((option: any) => option.key);
    const languageInputDisabled =
        busy ||
        languageOptionsStatus === 'running' ||
        selectedLanguageKeys.length >= 3 ||
        !availableLanguageOptions.length;
    const languageInputPlaceholder =
        languageOptionsStatus === 'running'
            ? t('dialog.user.loading.loading_languages')
            : t('dialog.user.action.select_language');

    function handleLanguageValueChange(values: any) {
        setDraft((current: any) => ({
            ...current,
            languageKeys: normalizeLanguageComboboxValues(values)
        }));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="grid max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl"
                onPointerDownOutside={preventDialogOutsideClose}
                onInteractOutside={preventDialogOutsideClose}
            >
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.user.description.edit_profile_details')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.user.description.update_your_profile_details'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="-mx-1 min-h-0 px-1">
                    <FieldGroup className="gap-4 pb-3">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field>
                                <div className="flex items-center justify-between gap-2">
                                    <FieldLabel>
                                        {t('dialog.user.label.languages')}
                                    </FieldLabel>
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {languageRows.length}/3
                                    </span>
                                </div>
                                <Combobox
                                    multiple
                                    autoHighlight
                                    items={selectableLanguageKeys}
                                    value={selectedLanguageKeys}
                                    itemToStringLabel={(key: any) =>
                                        languageLabelByKey.get(key) || key
                                    }
                                    onValueChange={handleLanguageValueChange}
                                >
                                    <ComboboxChips
                                        ref={languageComboboxAnchor}
                                        className="w-full"
                                    >
                                        <ComboboxValue>
                                            {(values: any) => (
                                                <>
                                                    {values.map(
                                                        (value: any) => (
                                                            <ComboboxChip
                                                                key={value}
                                                                showRemove={
                                                                    !busy
                                                                }
                                                            >
                                                                <span className="max-w-36 truncate">
                                                                    {languageLabelByKey.get(
                                                                        value
                                                                    ) || value}
                                                                </span>
                                                            </ComboboxChip>
                                                        )
                                                    )}
                                                    <ComboboxChipsInput
                                                        disabled={
                                                            languageInputDisabled
                                                        }
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
                                    <ComboboxContent
                                        anchor={languageComboboxAnchor}
                                    >
                                        <ComboboxEmpty>
                                            {t('dialog.user.empty.no_results')}
                                        </ComboboxEmpty>
                                        <ComboboxList>
                                            {(key: any) => (
                                                <ComboboxItem
                                                    key={key}
                                                    value={key}
                                                >
                                                    {languageLabelByKey.get(
                                                        key
                                                    ) || key}
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
                            <Field>
                                <div className="flex items-center justify-between gap-2">
                                    <FieldLabel htmlFor="user-profile-pronouns">
                                        {t('dialog.user.label.pronouns')}
                                    </FieldLabel>
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {pronounsLength}/32
                                    </span>
                                </div>
                                <Input
                                    id="user-profile-pronouns"
                                    value={draft.pronouns}
                                    placeholder={t(
                                        'dialog.pronouns.pronouns_placeholder'
                                    )}
                                    maxLength={32}
                                    disabled={busy}
                                    onChange={(event: any) => {
                                        setDraft((current: any) => ({
                                            ...current,
                                            pronouns: event.target.value.slice(
                                                0,
                                                32
                                            )
                                        }));
                                    }}
                                />
                            </Field>
                        </div>
                        <Separator className="-my-1" />
                        <Field>
                            <div className="flex items-center justify-between gap-2">
                                <FieldLabel>
                                    {t('dialog.user.label.bio_links')}
                                </FieldLabel>
                                <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {bioLinks.length}/3
                                    </span>
                                    {bioLinks.length < 3 ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="xs"
                                            disabled={busy}
                                            onClick={() => {
                                                setDraft((current: any) => ({
                                                    ...current,
                                                    bioLinks: [
                                                        ...(current.bioLinks
                                                            ?.length
                                                            ? current.bioLinks
                                                            : ['']),
                                                        ''
                                                    ].slice(0, 3)
                                                }));
                                            }}
                                        >
                                            <PlusIcon data-icon="inline-start" />
                                            {t(
                                                'dialog.user.action.add_bio_link'
                                            )}
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                {bioLinks.map((link: any, index: any) => (
                                    <InputGroup key={index}>
                                        <InputGroupInput
                                            value={link}
                                            placeholder={`https://example.com/${index + 1}`}
                                            maxLength={1000}
                                            disabled={busy}
                                            onChange={(event: any) => {
                                                const nextValue =
                                                    event.target.value.slice(
                                                        0,
                                                        1000
                                                    );
                                                setDraft((current: any) => {
                                                    const nextBioLinks = [
                                                        ...(current.bioLinks
                                                            ?.length
                                                            ? current.bioLinks
                                                            : [''])
                                                    ];
                                                    nextBioLinks[index] =
                                                        nextValue;
                                                    return {
                                                        ...current,
                                                        bioLinks:
                                                            nextBioLinks.slice(
                                                                0,
                                                                3
                                                            )
                                                    };
                                                });
                                            }}
                                        />
                                        <InputGroupAddon align="inline-end">
                                            <InputGroupButton
                                                type="button"
                                                size="icon-xs"
                                                disabled={
                                                    busy || bioLinks.length <= 1
                                                }
                                                aria-label={t(
                                                    'dialog.user.action.remove_bio_link'
                                                )}
                                                onClick={() => {
                                                    setDraft((current: any) => {
                                                        const nextBioLinks = [
                                                            ...(current.bioLinks
                                                                ?.length
                                                                ? current.bioLinks
                                                                : [''])
                                                        ];
                                                        nextBioLinks.splice(
                                                            index,
                                                            1
                                                        );
                                                        return {
                                                            ...current,
                                                            bioLinks:
                                                                nextBioLinks.length
                                                                    ? nextBioLinks
                                                                    : ['']
                                                        };
                                                    });
                                                }}
                                            >
                                                <XIcon data-icon="inline-start" />
                                            </InputGroupButton>
                                        </InputGroupAddon>
                                    </InputGroup>
                                ))}
                            </div>
                        </Field>
                        <Separator className="-my-1" />
                        <Field>
                            <div className="flex items-center justify-between gap-2">
                                <FieldLabel htmlFor="user-profile-bio">
                                    {t('dialog.user.label.bio')}
                                </FieldLabel>
                                <FieldDescription className="text-xs">
                                    {bioLength}/512
                                </FieldDescription>
                            </div>
                            <Textarea
                                id="user-profile-bio"
                                rows={6}
                                value={draft.bio}
                                placeholder={t('dialog.bio.bio_placeholder')}
                                maxLength={512}
                                disabled={busy}
                                className="field-sizing-fixed max-h-56 min-h-36 resize-y overflow-y-auto"
                                onChange={(event: any) => {
                                    setDraft((current: any) => ({
                                        ...current,
                                        bio: event.target.value.slice(0, 512)
                                    }));
                                }}
                            />
                        </Field>
                    </FieldGroup>
                </ScrollArea>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button type="button" disabled={busy} onClick={onSave}>
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
