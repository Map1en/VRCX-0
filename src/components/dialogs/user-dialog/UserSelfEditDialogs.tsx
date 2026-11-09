import { BookmarkIcon, HistoryIcon, XIcon } from 'lucide-react';
import { Fragment } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { UserStatus } from '@/platform/tauri/bindings';
import { userStatusIndicatorClassName } from '@/shared/utils/userStatus';
import { HintTooltip } from '@/ui/hint-tooltip';
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
import { Separator } from '@/ui/shadcn/separator';
import { Textarea } from '@/ui/shadcn/textarea';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import {
    ProfileLanguagesField,
    ProfileLinksField
} from '../ProfileDetailsFields';
import type { useCurrentUserSocialStatusDialog } from './useCurrentUserSocialStatusDialog';
import { normalizeSelfStatusInput } from './userProfileFields';
import type {
    SocialStatusDraft,
    SocialStatusPreset
} from './useSelfStatusPresets';
import type { ProfileDetailsDraft } from './useUserDialogSelfActions';

type LanguageOption = { key: string; value: string };
type StatusOption = { value: UserStatus; label: string };
type SocialStatusDialogController = ReturnType<
    typeof useCurrentUserSocialStatusDialog
>['dialog'];

function UserSocialStatusDialog({
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
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    actionStatus: string;
    draft: SocialStatusDraft;
    setDraft: Dispatch<SetStateAction<SocialStatusDraft>>;
    statusHistoryRows: string[];
    statusOptions: StatusOption[];
    statusPresets: SocialStatusPreset[];
    statusLabelByValue: ReadonlyMap<string, string>;
    onSavePreset: () => void;
    onRemovePreset: (index: number) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
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
                                onChange={(event) => {
                                    setDraft((current) => ({
                                        ...current,
                                        statusDescription:
                                            event.target.value.slice(0, 32)
                                    }));
                                }}
                            />
                            <InputGroupAddon align="inline-end">
                                {draft.statusDescription ? (
                                    <HintTooltip
                                        label={t(
                                            'dialog.user.description.clear_status_description'
                                        )}
                                    >
                                        <InputGroupButton
                                            size="icon-xs"
                                            disabled={busy}
                                            onClick={() => {
                                                setDraft((current) => ({
                                                    ...current,
                                                    statusDescription: ''
                                                }));
                                            }}
                                        >
                                            <XIcon data-icon="inline-start" />
                                        </InputGroupButton>
                                    </HintTooltip>
                                ) : null}
                                <DropdownMenu>
                                    <HintTooltip
                                        label={t(
                                            'dialog.user.label.status_history'
                                        )}
                                    >
                                        <DropdownMenuTrigger
                                            render={
                                                <InputGroupButton
                                                    size="icon-xs"
                                                    disabled={busy}
                                                >
                                                    <HistoryIcon data-icon="inline-start" />
                                                </InputGroupButton>
                                            }
                                        />
                                    </HintTooltip>
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
                                                            onClick={() => {
                                                                setDraft(
                                                                    (
                                                                        current
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
                            variant="outline"
                            value={draft.status ? [draft.status] : []}
                            className="w-full overflow-x-auto"
                            aria-label={t('dialog.user.label.social_status')}
                            onValueChange={(value) => {
                                const nextStatus = normalizeSelfStatusInput(
                                    value[0]
                                );
                                if (!nextStatus) {
                                    return;
                                }
                                setDraft((current) => ({
                                    ...current,
                                    status: nextStatus
                                }));
                            }}
                        >
                            {statusOptions.map((option, index) => {
                                return (
                                    <Fragment key={option.value}>
                                        {index > 0 ? (
                                            <ToggleGroupSeparator />
                                        ) : null}
                                        <ToggleGroupItem
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
                                    </Fragment>
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
                                {statusPresets.map((preset, index) => {
                                    const presetStatus =
                                        preset.status || 'active';
                                    const presetDescription = (
                                        preset.statusDescription ?? ''
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
                                                aria-label={t(
                                                    'accessibility.apply_status_preset',
                                                    { preset: label }
                                                )}
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
                                            <HintTooltip
                                                label={t(
                                                    'accessibility.remove_status_preset'
                                                )}
                                            >
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon-xs"
                                                    className="shrink-0 rounded-l-none"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        onRemovePreset(index)
                                                    }
                                                >
                                                    <XIcon data-icon="inline-start" />
                                                </Button>
                                            </HintTooltip>
                                        </div>
                                    );
                                })}
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

export function CurrentUserSocialStatusDialog({
    controller,
    actionStatus
}: {
    controller: SocialStatusDialogController;
    actionStatus?: string;
}) {
    return (
        <UserSocialStatusDialog
            open={controller.open}
            onOpenChange={controller.onOpenChange}
            actionStatus={actionStatus ?? (controller.busy ? 'saving' : 'idle')}
            draft={controller.draft}
            setDraft={controller.setDraft}
            statusHistoryRows={controller.statusHistoryRows}
            statusOptions={controller.statusOptions}
            statusPresets={controller.statusPresets}
            statusLabelByValue={controller.statusLabelByValue}
            onSavePreset={controller.onSavePreset}
            onRemovePreset={controller.onRemovePreset}
            onCancel={controller.onCancel}
            onSave={controller.onSave}
        />
    );
}

export function UserProfileDetailsFields({
    busy,
    draft,
    setDraft,
    languageRows,
    availableLanguageOptions,
    languageOptionsStatus
}: {
    busy: boolean;
    draft: ProfileDetailsDraft;
    setDraft: Dispatch<SetStateAction<ProfileDetailsDraft>>;
    languageRows: LanguageOption[];
    availableLanguageOptions: LanguageOption[];
    languageOptionsStatus: string;
}) {
    const { t } = useTranslation();

    const bioLength = String(draft.bio || '').length;
    const pronounsLength = String(draft.pronouns || '').length;

    return (
        <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <ProfileLanguagesField
                    languageRows={languageRows}
                    availableLanguageOptions={availableLanguageOptions}
                    languageOptionsStatus={languageOptionsStatus}
                    busy={busy}
                    onChange={(languageKeys) => {
                        setDraft((current) => ({
                            ...current,
                            languageKeys
                        }));
                    }}
                />
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
                        placeholder={t('dialog.pronouns.pronouns_placeholder')}
                        maxLength={32}
                        disabled={busy}
                        onChange={(event) => {
                            setDraft((current) => ({
                                ...current,
                                pronouns: event.target.value.slice(0, 32)
                            }));
                        }}
                    />
                </Field>
            </div>
            <Separator className="-my-1" />
            <ProfileLinksField
                label={t('dialog.user.label.bio_links')}
                addLabel={t('dialog.user.action.add_bio_link')}
                removeLabel={t('dialog.user.action.remove_bio_link')}
                links={draft.bioLinks}
                busy={busy}
                onChange={(bioLinks) => {
                    setDraft((current) => ({
                        ...current,
                        bioLinks
                    }));
                }}
            />
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
                    onChange={(event) => {
                        setDraft((current) => ({
                            ...current,
                            bio: event.target.value.slice(0, 512)
                        }));
                    }}
                />
            </Field>
        </FieldGroup>
    );
}
