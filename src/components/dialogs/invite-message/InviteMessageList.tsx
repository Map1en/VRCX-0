import { CheckIcon, ClockIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { toast } from '@/services/toastService';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    getInviteCooldownLabel,
    rowUpdatedAt,
    type InviteMessageRow
} from './inviteMessageData';
import type { InviteMessagesState } from './useInviteMessages';

const MESSAGE_MAX_LENGTH = 64;

type InviteMessageListProps = {
    messages: InviteMessagesState;
    allowEdit?: boolean;
    compact?: boolean;
    disabled?: boolean;
    selectedSlot?: number | null;
    onSelect?: (row: InviteMessageRow) => void;
    onSaved?: (row: InviteMessageRow) => void;
};

export function InviteMessageList({
    messages,
    allowEdit = false,
    compact = false,
    disabled = false,
    selectedSlot = null,
    onSelect,
    onSaved
}: InviteMessageListProps) {
    const { t } = useTranslation();
    const [editingSlot, setEditingSlot] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [editError, setEditError] = useState('');
    const { rows, loading, error, nowMs } = messages;

    function cooldownLabel(row: InviteMessageRow) {
        return getInviteCooldownLabel(rowUpdatedAt(row), nowMs);
    }

    function beginEdit(row: InviteMessageRow) {
        if (cooldownLabel(row)) {
            toast.add({
                type: 'warning',
                title: t(
                    'dialog.invite_message.error.this_message_template_is_on_cooldown_and_cannot_be_edited_yet'
                )
            });
            return;
        }
        setEditingSlot(row.slot);
        setDraft(row.message);
        setEditError('');
    }

    async function saveEdit(row: InviteMessageRow) {
        setSaving(true);
        setEditError('');
        try {
            await messages.save(row, draft);
            setEditingSlot(null);
            toast.add({
                type: 'success',
                title: t('message.invite.message_updated')
            });
            onSaved?.({ ...row, message: draft });
        } catch (nextError) {
            setEditError(
                nextError instanceof Error
                    ? nextError.message
                    : t(
                          'dialog.edit_invite_messages.error.failed_to_update_template'
                      )
            );
        } finally {
            setSaving(false);
        }
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    if (loading && !rows.length) {
        return (
            <div className="text-muted-foreground flex h-24 items-center justify-center gap-2 text-sm">
                <Spinner />
                {t('common.loading')}
            </div>
        );
    }

    if (!rows.length) {
        return (
            <div className="text-muted-foreground flex h-24 items-center justify-center text-sm">
                {t('common.no_data')}
            </div>
        );
    }

    const slotClassName =
        'text-muted-foreground w-5 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums';

    return (
        <ul
            className={cn(
                compact ? 'flex flex-col gap-0.5' : 'divide-y rounded-md border'
            )}
        >
            {rows.map((row) => {
                if (editingSlot === row.slot) {
                    return (
                        <li
                            key={row.slot}
                            className="bg-muted/40 flex gap-3 px-3 py-2.5"
                        >
                            <span className={cn(slotClassName, 'pt-2')}>
                                {row.slot}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col gap-2">
                                <Textarea
                                    value={draft}
                                    maxLength={MESSAGE_MAX_LENGTH}
                                    rows={2}
                                    autoFocus
                                    disabled={saving}
                                    aria-label={t(
                                        'dialog.invite_message.dynamic.edit_slot_value',
                                        { value: row.slot }
                                    )}
                                    onChange={(event) =>
                                        setDraft(event.target.value)
                                    }
                                />
                                {editError ? (
                                    <p className="text-destructive text-xs">
                                        {editError}
                                    </p>
                                ) : null}
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {draft.length}/{MESSAGE_MAX_LENGTH}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={saving}
                                            onClick={() => setEditingSlot(null)}
                                        >
                                            {t('common.actions.cancel')}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            disabled={saving}
                                            onClick={() => {
                                                saveEdit(row);
                                            }}
                                        >
                                            {saving ? (
                                                <Spinner data-icon="inline-start" />
                                            ) : null}
                                            {t(
                                                'dialog.edit_invite_message.save'
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </li>
                    );
                }

                const cooldown = cooldownLabel(row);
                const selected = selectedSlot === row.slot;
                return (
                    <li
                        key={row.slot}
                        data-selected={selected || undefined}
                        className={cn(
                            'group hover:bg-accent/50 data-selected:bg-accent flex items-start gap-2 transition-colors',
                            compact ? 'rounded-md px-2 py-1.5' : 'px-3 py-2'
                        )}
                    >
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-start gap-3 py-0.5 text-left outline-none disabled:cursor-not-allowed"
                            disabled={disabled || (!onSelect && !allowEdit)}
                            onClick={() => {
                                if (onSelect) {
                                    onSelect(row);
                                } else {
                                    beginEdit(row);
                                }
                            }}
                        >
                            <span className={slotClassName}>{row.slot}</span>
                            <span className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">
                                {row.message || '-'}
                            </span>
                        </button>
                        {cooldown ? (
                            <span
                                className="text-muted-foreground inline-flex h-6 shrink-0 items-center gap-1 text-xs"
                                title={t(
                                    'table.profile.invite_messages.cool_down'
                                )}
                            >
                                <ClockIcon className="size-3.5" />
                                {cooldown}
                            </span>
                        ) : allowEdit ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                                disabled={disabled}
                                aria-label={t(
                                    'dialog.invite_message.dynamic.edit_slot_value',
                                    { value: row.slot }
                                )}
                                onClick={() => beginEdit(row)}
                            >
                                <PencilIcon />
                            </Button>
                        ) : null}
                        {onSelect ? (
                            <span className="flex h-6 w-4 shrink-0 items-center">
                                {selected ? (
                                    <CheckIcon className="size-4" />
                                ) : null}
                            </span>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
