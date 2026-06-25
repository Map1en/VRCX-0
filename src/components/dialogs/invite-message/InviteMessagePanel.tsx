import { ImageIcon, PencilIcon, RefreshCcwIcon, SendIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile
} from '@/shared/utils/imageUpload';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { DialogFooter } from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    getInviteCooldownLabel,
    isInviteMessageOnCooldown,
    normalizeInviteMessageRows,
    primaryActionLabel,
    rowUpdatedAt,
    saveInviteMessage,
    validModes
} from './inviteMessagePanelData';

export {
    dialogDescription,
    dialogTitle,
    getInviteCooldownLabel,
    INVITE_MESSAGE_TYPES,
    normalizeInviteMessageRows
} from './inviteMessagePanelData';
export function InviteMessagePanel({
    currentUserId,
    endpoint,
    messageType,
    mode,
    targetLabel,
    allowEdit,
    allowImageUpload,
    onUse,
    onSave,
    onClose
}: any) {
    const { t } = useTranslation();

    const resolvedMode = validModes.has(mode) ? mode : 'select';
    const resolvedMessageType = messageType || 'message';
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [confirmRow, setConfirmRow] = useState<any>(null);
    const [editingRow, setEditingRow] = useState<any>(null);
    const [editMessage, setEditMessage] = useState('');
    const [imageData, setImageData] = useState('');
    const [imageName, setImageName] = useState('');
    const [nowMs, setNowMs] = useState(() => Date.now());
    const requestIdRef = useRef(0);

    async function loadRows() {
        if (!currentUserId) {
            requestIdRef.current += 1;
            setRows([]);
            setError(
                t(
                    'dialog.user.error.cannot_load_message_templates_no_current_user_session_is_available'
                )
            );
            setLoading(false);
            return;
        }

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const response = await vrchatToolsRepository.getInviteMessages(
                { currentUserId, messageType: resolvedMessageType },
                { endpoint }
            );
            if (requestIdRef.current !== requestId) {
                return;
            }
            setRows(normalizeInviteMessageRows(response, resolvedMessageType));
        } catch (nextError) {
            if (requestIdRef.current !== requestId) {
                return;
            }
            setRows([]);
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : t(
                          'dialog.edit_invite_messages.error.failed_to_load_templates'
                      )
            );
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        loadRows();
        return () => {
            requestIdRef.current += 1;
        };
    }, [currentUserId, endpoint, resolvedMessageType]);

    useEffect(() => {
        setConfirmRow(null);
        setEditingRow(null);
        setEditMessage('');
        setImageData('');
        setImageName('');
    }, [resolvedMessageType, resolvedMode]);

    useEffect(() => {
        const intervalId = window.setInterval(() => setNowMs(Date.now()), 5000);
        return () => window.clearInterval(intervalId);
    }, []);

    async function handleImageChange(event: any) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }

        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            setError(
                validation.reason === 'too_large'
                    ? t('message.image.error.selected_image_is_too_large')
                    : t('message.image.success.selected_file_is_not_image')
            );
            return;
        }

        try {
            setImageData(await readFileAsBase64(file));
            setImageName(file.name || 'image');
            setError('');
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : t('message.image.error.failed_to_read_image')
            );
        }
    }

    function beginEdit(row: any) {
        if (!allowEdit) {
            return;
        }
        if (isInviteMessageOnCooldown(row, nowMs)) {
            toast.warning(
                t(
                    'dialog.invite_message.error.this_message_template_is_on_cooldown_and_cannot_be_edited_yet'
                )
            );
            return;
        }
        setConfirmRow(null);
        setEditingRow(row);
        setEditMessage(row?.message || '');
    }

    async function saveMessage(row: any, message: any) {
        const save = onSave || saveInviteMessage;
        await save({
            currentUserId,
            endpoint,
            messageType: resolvedMessageType,
            row,
            message,
            t
        });
    }

    async function saveEdit() {
        if (!editingRow) {
            return;
        }
        if (isInviteMessageOnCooldown(editingRow, nowMs)) {
            setError(
                t(
                    'dialog.invite_message.error.this_message_template_is_on_cooldown_and_cannot_be_edited_yet'
                )
            );
            return;
        }

        setSending(true);
        setError('');
        try {
            await saveMessage(editingRow, editMessage);
            setEditingRow(null);
            await loadRows();
            toast.success(t('message.invite.message_updated'));
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : t(
                          'dialog.edit_invite_messages.error.failed_to_update_template'
                      )
            );
        } finally {
            setSending(false);
        }
    }

    async function useRow(row: any, message: any = row?.message || '') {
        if (!row || sending) {
            return;
        }
        const nextMessage =
            resolvedMode === 'respond' ? String(message || '').trim() : message;
        if (resolvedMode === 'respond' && !nextMessage) {
            setError(t('dialog.invite_message.error.message_required'));
            return;
        }

        setSending(true);
        setError('');
        try {
            if (
                allowEdit &&
                nextMessage !== String(row?.message || '') &&
                resolvedMode !== 'select'
            ) {
                if (isInviteMessageOnCooldown(row, nowMs)) {
                    throw new Error(
                        t(
                            'dialog.invite_message.error.this_message_template_is_on_cooldown_and_cannot_be_edited_yet'
                        )
                    );
                }
                await saveMessage(row, nextMessage);
            }
            const result = await onUse?.({
                row,
                messageType: resolvedMessageType,
                message: nextMessage,
                imageData
            });
            if (result !== false) {
                onClose?.();
            }
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : t(
                          'dialog.edit_invite_messages.error.failed_to_use_template'
                      )
            );
        } finally {
            setSending(false);
        }
    }

    const showActionColumn =
        allowEdit || resolvedMode === 'respond' || Boolean(onUse);
    const actionLabel = primaryActionLabel(
        resolvedMode,
        resolvedMessageType,
        t
    );

    return (
        <div className="flex min-h-0 flex-col gap-3">
            {allowImageUpload ? (
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        type="file"
                        accept={IMAGE_UPLOAD_ACCEPT}
                        className="max-w-sm"
                        disabled={sending}
                        onChange={(event: any) => {
                            handleImageChange(event);
                        }}
                    />
                    {imageName ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={sending}
                            onClick={() => {
                                setImageData('');
                                setImageName('');
                            }}
                        >
                            <ImageIcon data-icon="inline-start" />
                            {t(
                                'dialog.invite_message.clear_selected_image'
                            )}{' '}
                            {imageName}
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {targetLabel && resolvedMode !== 'manage' ? (
                <div className="text-muted-foreground text-sm">
                    {t('dialog.invite_message.label.target')} {targetLabel}
                </div>
            ) : null}
            {error ? (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-20">
                                {t('table.profile.invite_messages.slot')}
                            </TableHead>
                            <TableHead>
                                {t('table.profile.invite_messages.message')}
                            </TableHead>
                            <TableHead className="w-32 text-right">
                                {t('table.profile.invite_messages.cool_down')}
                            </TableHead>
                            {showActionColumn ? (
                                <TableHead className="w-28 text-right">
                                    {t('table.profile.invite_messages.action')}
                                </TableHead>
                            ) : null}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell
                                    colSpan={showActionColumn ? 4 : 3}
                                    className="text-muted-foreground h-24 text-center"
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <Spinner data-icon="inline-start" />
                                        {t('common.loading')}
                                    </span>
                                </TableCell>
                            </TableRow>
                        ) : rows.length ? (
                            rows.map((row: any) => {
                                const cooldownLabel = getInviteCooldownLabel(
                                    rowUpdatedAt(row),
                                    nowMs
                                );
                                const editDisabled = Boolean(cooldownLabel);
                                const selected =
                                    confirmRow?.slot === row.slot ||
                                    editingRow?.slot === row.slot;
                                return (
                                    <TableRow
                                        key={`${resolvedMessageType}:${row.slot}`}
                                        className={cn(
                                            selected && 'bg-muted/70'
                                        )}
                                    >
                                        <TableCell className="font-mono text-xs">
                                            {row.slot}
                                        </TableCell>
                                        <TableCell className="whitespace-normal">
                                            {row.message || '-'}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-right text-xs">
                                            {cooldownLabel || '-'}
                                        </TableCell>
                                        {showActionColumn ? (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    {allowEdit ? (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-xs"
                                                            aria-label={t(
                                                                'dialog.invite_message.dynamic.edit_slot_value',
                                                                {
                                                                    value: row.slot
                                                                }
                                                            )}
                                                            disabled={
                                                                sending ||
                                                                editDisabled
                                                            }
                                                            onClick={(
                                                                event: any
                                                            ) => {
                                                                event.stopPropagation();
                                                                beginEdit(row);
                                                            }}
                                                        >
                                                            <PencilIcon data-icon="inline-start" />
                                                        </Button>
                                                    ) : null}
                                                    {resolvedMode ===
                                                    'select' ? (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={sending}
                                                            onClick={(
                                                                event: any
                                                            ) => {
                                                                event.stopPropagation();
                                                                useRow(row);
                                                            }}
                                                        >
                                                            {actionLabel}
                                                        </Button>
                                                    ) : null}
                                                    {resolvedMode ===
                                                    'respond' ? (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={sending}
                                                            onClick={() => {
                                                                setEditingRow(
                                                                    null
                                                                );
                                                                setConfirmRow(
                                                                    row
                                                                );
                                                            }}
                                                        >
                                                            {actionLabel}
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </TableCell>
                                        ) : null}
                                    </TableRow>
                                );
                            })
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={showActionColumn ? 4 : 3}
                                    className="text-muted-foreground h-24 text-center"
                                >
                                    {t('common.no_data')}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            {editingRow ? (
                <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="text-sm font-medium">
                        {resolvedMode === 'respond'
                            ? t('dialog.edit_send_invite_message.header')
                            : t('dialog.edit_invite_message.header')}{' '}
                        {t('table.profile.invite_messages.slot')}{' '}
                        <span className="font-mono">{editingRow.slot}</span>
                    </div>
                    <Textarea
                        value={editMessage}
                        maxLength={64}
                        rows={2}
                        disabled={sending}
                        onChange={(event: any) =>
                            setEditMessage(event.target.value)
                        }
                    />
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground text-xs">
                            {editMessage.length}/64
                        </span>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={sending}
                                onClick={() => setEditingRow(null)}
                            >
                                {t('common.actions.cancel')}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                disabled={
                                    sending ||
                                    (resolvedMode === 'respond' &&
                                        !editMessage.trim())
                                }
                                onClick={() => {
                                    if (resolvedMode === 'respond') {
                                        useRow(editingRow, editMessage.trim());
                                        return;
                                    }
                                    saveEdit();
                                }}
                            >
                                {sending ? (
                                    <Spinner data-icon="inline-start" />
                                ) : resolvedMode === 'respond' ? (
                                    <SendIcon data-icon="inline-start" />
                                ) : null}
                                {resolvedMode === 'respond'
                                    ? t('dialog.edit_send_invite_message.send')
                                    : t('dialog.edit_invite_message.save')}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : confirmRow ? (
                <div className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 text-sm">
                        {t('dialog.edit_send_invite_message.send')}{' '}
                        {t('table.profile.invite_messages.slot')}{' '}
                        <span className="font-mono">{confirmRow.slot}</span>
                        {confirmRow.message ? (
                            <span className="text-muted-foreground ml-2">
                                {confirmRow.message}
                            </span>
                        ) : null}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={sending}
                            onClick={() => setConfirmRow(null)}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={sending}
                            onClick={() => {
                                useRow(confirmRow);
                            }}
                        >
                            {sending ? (
                                <Spinner data-icon="inline-start" />
                            ) : (
                                <SendIcon data-icon="inline-start" />
                            )}
                            {t('common.actions.confirm')}
                        </Button>
                    </div>
                </div>
            ) : null}
            <DialogFooter>
                <Button
                    type="button"
                    variant="outline"
                    disabled={loading || sending}
                    onClick={() => {
                        loadRows();
                    }}
                >
                    <RefreshCcwIcon data-icon="inline-start" />
                    {t('common.actions.refresh')}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    disabled={sending}
                    onClick={onClose}
                >
                    {t('common.actions.close')}
                </Button>
            </DialogFooter>
        </div>
    );
}
