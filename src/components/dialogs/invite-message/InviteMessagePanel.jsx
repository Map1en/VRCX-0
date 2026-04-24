import { ImageIcon, PencilIcon, RefreshCcwIcon, SendIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { cn } from '@/lib/utils.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile
} from '@/shared/utils/imageUpload.js';
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
    dialogDescription,
    dialogTitle,
    isInviteMessageOnCooldown,
    normalizeInviteMessageRows,
    primaryActionLabel,
    rowUpdatedAt,
    saveInviteMessage,
    validModes
} from './inviteMessagePanelData.js';

export {
    dialogDescription,
    dialogTitle,
    getInviteCooldownLabel,
    INVITE_MESSAGE_TYPES,
    normalizeInviteMessageRows
} from './inviteMessagePanelData.js';
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
}) {
    const { t } = useTranslation();

    const resolvedMode = validModes.has(mode) ? mode : 'select';
    const resolvedMessageType = messageType || 'message';
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [confirmRow, setConfirmRow] = useState(null);
    const [editingRow, setEditingRow] = useState(null);
    const [editMessage, setEditMessage] = useState('');
    const [imageData, setImageData] = useState('');
    const [imageName, setImageName] = useState('');
    const [nowMs, setNowMs] = useState(() => Date.now());
    const requestIdRef = useRef(0);

    async function loadRows() {
        if (!currentUserId) {
            requestIdRef.current += 1;
            setRows([]);
            setError('No current user session is available.');
            setLoading(false);
            return;
        }

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const response = await toolsRepository.getInviteMessages(
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
                    : 'Failed to load invite message templates.'
            );
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        void loadRows();
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

    async function handleImageChange(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }

        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            setError(
                validation.reason === 'too_large'
                    ? 'Selected image is too large.'
                    : 'Selected file is not an image.'
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
                    : 'Failed to read image.'
            );
        }
    }

    function beginEdit(row) {
        if (!allowEdit) {
            return;
        }
        if (isInviteMessageOnCooldown(row, nowMs)) {
            toast.warning(
                t(
                    'dialog.invite_message.generated.this_message_template_is_on_cooldown_and_cannot_be_edited_ye'
                )
            );
            return;
        }
        setConfirmRow(null);
        setEditingRow(row);
        setEditMessage(row?.message || '');
    }

    async function saveMessage(row, message) {
        const save = onSave || saveInviteMessage;
        await save({
            currentUserId,
            endpoint,
            messageType: resolvedMessageType,
            row,
            message
        });
    }

    async function saveEdit() {
        if (!editingRow) {
            return;
        }
        if (isInviteMessageOnCooldown(editingRow, nowMs)) {
            setError('This message template is on cooldown.');
            return;
        }

        setSending(true);
        setError('');
        try {
            await saveMessage(editingRow, editMessage);
            setEditingRow(null);
            await loadRows();
            toast.success(
                t('dialog.invite_message.generated.message_template_updated')
            );
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : 'Failed to update message template.'
            );
        } finally {
            setSending(false);
        }
    }

    async function useRow(row, message = row?.message || '') {
        if (!row || sending) {
            return;
        }
        const nextMessage =
            resolvedMode === 'respond' ? String(message || '').trim() : message;
        if (resolvedMode === 'respond' && !nextMessage) {
            setError('Message cannot be empty.');
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
                    throw new Error('This message template is on cooldown.');
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
                    : 'Failed to use message template.'
            );
        } finally {
            setSending(false);
        }
    }

    const showActionColumn =
        allowEdit || resolvedMode === 'respond' || Boolean(onUse);
    const actionLabel = primaryActionLabel(resolvedMode, resolvedMessageType);

    return (
        <div className="flex min-h-0 flex-col gap-3">
            {allowImageUpload ? (
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        type="file"
                        accept={IMAGE_UPLOAD_ACCEPT}
                        className="max-w-sm"
                        disabled={sending}
                        onChange={(event) => void handleImageChange(event)}
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
                                'dialog.invite_message.generated.clear_image'
                            )}{' '}
                            {imageName}
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {targetLabel && resolvedMode !== 'manage' ? (
                <div className="text-muted-foreground text-sm">
                    {t('dialog.invite_message.generated.target')} {targetLabel}
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
                                {t('dialog.invite_message.generated.message')}
                            </TableHead>
                            <TableHead className="w-32 text-right">
                                {t('dialog.invite_message.generated.cooldown')}
                            </TableHead>
                            {showActionColumn ? (
                                <TableHead className="w-28 text-right">
                                    {t(
                                        'dialog.invite_message.generated.action'
                                    )}
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
                                        {t(
                                            'dialog.invite_message.generated.loading_message_templates'
                                        )}
                                    </span>
                                </TableCell>
                            </TableRow>
                        ) : rows.length ? (
                            rows.map((row) => {
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
                                                            aria-label={`Edit slot ${row.slot}`}
                                                            disabled={
                                                                sending ||
                                                                editDisabled
                                                            }
                                                            onClick={(
                                                                event
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
                                                                event
                                                            ) => {
                                                                event.stopPropagation();
                                                                void useRow(
                                                                    row
                                                                );
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
                                    {t(
                                        'dialog.invite_message.generated.no_message_templates'
                                    )}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            {editingRow ? (
                <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="text-sm font-medium">
                        {resolvedMode === 'respond' ? 'Edit and send' : 'Edit'}{' '}
                        {t('dialog.invite_message.generated.slot')}{' '}
                        <span className="font-mono">{editingRow.slot}</span>
                    </div>
                    <Textarea
                        value={editMessage}
                        maxLength={64}
                        rows={2}
                        disabled={sending}
                        onChange={(event) => setEditMessage(event.target.value)}
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
                                onClick={() =>
                                    resolvedMode === 'respond'
                                        ? void useRow(
                                              editingRow,
                                              editMessage.trim()
                                          )
                                        : void saveEdit()
                                }
                            >
                                {sending ? (
                                    <Spinner data-icon="inline-start" />
                                ) : resolvedMode === 'respond' ? (
                                    <SendIcon data-icon="inline-start" />
                                ) : null}
                                {resolvedMode === 'respond' ? 'Send' : 'Save'}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : confirmRow ? (
                <div className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 text-sm">
                        {t('dialog.invite_message.generated.send_slot')}{' '}
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
                            onClick={() => void useRow(confirmRow)}
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
                    onClick={() => void loadRows()}
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
