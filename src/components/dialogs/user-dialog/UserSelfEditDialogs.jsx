import {
    BookmarkIcon,
    CheckIcon,
    HistoryIcon,
    XIcon
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { userStatusIndicatorClassName } from '@/lib/userStatus.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    languageOptionLabel,
    normalizeSelfStatusInput
} from './userProfileFields.js';

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
}) {
    const { t } = useTranslation();

    const busy = actionStatus !== 'idle';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.user.generated.edit_social_status')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.user.generated.update_your_social_status_and_status_description')}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="user-social-status-description">
                            {t('dialog.user.generated.status_description')}
                        </FieldLabel>
                        <div className="flex items-center gap-2">
                            <Input
                                id="user-social-status-description"
                                value={draft.statusDescription}
                                maxLength={32}
                                placeholder={t('dialog.user.generated.status_description')}
                                disabled={busy}
                                onChange={(event) => {
                                    setDraft((current) => ({
                                        ...current,
                                        statusDescription:
                                            event.target.value.slice(0, 32)
                                    }));
                                }}
                            />
                            {draft.statusDescription ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    disabled={busy}
                                    aria-label="Clear status description"
                                    onClick={() => {
                                        setDraft((current) => ({
                                            ...current,
                                            statusDescription: ''
                                        }));
                                    }}
                                >
                                    <XIcon data-icon="inline-start" />
                                </Button>
                            ) : null}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        disabled={busy}
                                        aria-label="Status history"
                                    >
                                        <HistoryIcon data-icon="inline-start" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="max-w-72"
                                >
                                    <DropdownMenuGroup>
                                        {statusHistoryRows.length ? (
                                            statusHistoryRows.map(
                                                (status, index) => (
                                                    <DropdownMenuItem
                                                        key={`${status}:${index}`}
                                                        onSelect={() => {
                                                            setDraft(
                                                                (current) => ({
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
                                                {t('dialog.user.generated.no_status_history')}
                                            </DropdownMenuItem>
                                        )}
                                    </DropdownMenuGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <div className="text-muted-foreground text-xs">
                            {draft.statusDescription.length}/32
                        </div>
                    </Field>
                    <Field>
                        <FieldLabel>{t('dialog.user.generated.social_status')}</FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            value={draft.status}
                            orientation="vertical"
                            spacing={2}
                            className="w-full"
                            aria-label="Social status"
                            onValueChange={(nextStatus) => {
                                if (!nextStatus) {
                                    return;
                                }
                                setDraft((current) => ({
                                    ...current,
                                    status: nextStatus
                                }));
                            }}
                        >
                            {statusOptions.map((option) => {
                                const selected = draft.status === option.value;
                                return (
                                    <ToggleGroupItem
                                        key={option.value}
                                        value={option.value}
                                        aria-label={option.label}
                                        disabled={busy}
                                        className="h-auto w-full justify-start gap-3 px-3 py-2"
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
                                        <span className="min-w-0 flex-1 truncate">
                                            {option.label}
                                        </span>
                                        {selected ? (
                                            <CheckIcon data-icon="inline-end" />
                                        ) : null}
                                    </ToggleGroupItem>
                                );
                            })}
                        </ToggleGroup>
                    </Field>
                    {statusPresets.length ? (
                        <Field>
                            <FieldLabel>{t('dialog.social_status.presets')}</FieldLabel>
                            <div className="flex flex-wrap gap-2">
                                {statusPresets.map((preset, index) => {
                                    const presetStatus =
                                        normalizeSelfStatusInput(
                                            preset?.status
                                        ) || 'active';
                                    const presetDescription = String(
                                        preset?.statusDescription || ''
                                    ).slice(0, 32);
                                    const label =
                                        presetDescription ||
                                        statusLabelByValue.get(presetStatus) ||
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
                                })}
                            </div>
                        </Field>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={onSavePreset}
                    >
                        <BookmarkIcon data-icon="inline-start" />
                        {t('dialog.user.generated.save_preset')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button type="button" disabled={busy} onClick={onSave}>
                        {t('dialog.user.generated.update')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function UserLanguageDialog({
    open,
    onOpenChange,
    actionStatus,
    currentLanguageRows,
    availableLanguageOptions,
    selectedLanguageToAdd,
    languageOptionsStatus,
    onSelectedLanguageChange,
    onAddLanguage,
    onRemoveLanguage
}) {
    const { t } = useTranslation();

    const busy = actionStatus !== 'idle';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('dialog.user.generated.edit_language')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.user.generated.add_or_remove_the_languages_shown_on_your_profile')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <div className="flex min-h-8 flex-wrap gap-2">
                        {currentLanguageRows.length ? (
                            currentLanguageRows.map((language) => (
                                <Badge
                                    key={language.key}
                                    variant="outline"
                                    className="gap-1.5 pr-1"
                                    title={languageOptionLabel(language)}
                                >
                                    <span>{languageOptionLabel(language)}</span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        disabled={busy}
                                        aria-label={`Remove ${languageOptionLabel(language)}`}
                                        onClick={() =>
                                            onRemoveLanguage(language.key)
                                        }
                                    >
                                        <XIcon data-icon="inline-start" />
                                    </Button>
                                </Badge>
                            ))
                        ) : (
                            <div className="text-muted-foreground text-sm">
                                {t('dialog.user.generated.no_languages_selected')}
                            </div>
                        )}
                    </div>
                    <Select
                        value={selectedLanguageToAdd}
                        disabled={
                            busy ||
                            languageOptionsStatus === 'running' ||
                            currentLanguageRows.length >= 3 ||
                            !availableLanguageOptions.length
                        }
                        onValueChange={(value) => {
                            onSelectedLanguageChange(value);
                            onAddLanguage(value);
                        }}
                    >
                        <SelectTrigger className="w-full" size="sm">
                            <SelectValue
                                placeholder={
                                    currentLanguageRows.length >= 3
                                        ? 'Maximum 3 languages'
                                        : languageOptionsStatus === 'running'
                                          ? 'Loading languages'
                                          : 'Select language'
                                }
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {availableLanguageOptions.map((option) => (
                                    <SelectItem
                                        key={option.key}
                                        value={option.key}
                                        textValue={languageOptionLabel(option)}
                                    >
                                        {languageOptionLabel(option)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    {languageOptionsStatus === 'error' ? (
                        <div className="text-muted-foreground text-xs">
                            {t('dialog.user.generated.vrchat_language_list_unavailable_using_local_language_codes')}
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
