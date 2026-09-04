import { ImageIcon, PencilIcon, RefreshCcwIcon, SendIcon } from 'lucide-react';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type MouseEvent
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    DATA_TABLE_CONTROL_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_CELL_CLASS_NAME,
    DATA_TABLE_NUMERIC_HEADER_CLASS_NAME,
    DataTableCell,
    DataTableHead,
    DataTableHeaderRow,
    DataTableRow
} from '@/components/data-table/DataTableView';
import type { InviteMessageType } from '@/platform/tauri/bindings';
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
import { Table, TableBody, TableHeader } from '@/ui/shadcn/table';
import { Textarea } from '@/ui/shadcn/textarea';

import {
    getInviteCooldownLabel,
    isInviteMessageOnCooldown,
    normalizeInviteMessageRows,
    primaryActionLabel,
    rowUpdatedAt,
    saveInviteMessage,
    type InviteMessageMode,
    type InviteMessageRow,
    type InviteMessageSavePayload,
    type InviteMessageUsePayload
} from './inviteMessagePanelData';

export {
    dialogDescription,
    dialogTitle,
    getInviteCooldownLabel,
    isInviteMessageType,
    INVITE_MESSAGE_TYPES,
    normalizeInviteMessageRows
} from './inviteMessagePanelData';

export type {
    InviteMessageMode,
    InviteMessageRow,
    InviteMessageSavePayload,
    InviteMessageUsePayload
} from './inviteMessagePanelData';

type InviteMessagePanelProps = {
    currentUserId?: string | null;
    endpoint?: string | null;
    messageType?: InviteMessageType | null;
    mode?: InviteMessageMode | null;
    targetLabel?: string | null;
    allowEdit?: boolean;
    allowImageUpload?: boolean;
    onUse?:
        | ((
              payload: InviteMessageUsePayload
          ) => boolean | void | Promise<boolean | void>)
        | null;
    onSave?:
        | ((payload: InviteMessageSavePayload) => void | Promise<void>)
        | null;
    onClose?: (() => void) | null;
};

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
}: InviteMessagePanelProps) {
    const { t } = useTranslation();

    const resolvedMode = mode ?? 'select';
    const resolvedMessageType = messageType ?? 'message';
    const [rows, setRows] = useState<InviteMessageRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [confirmRow, setConfirmRow] = useState<InviteMessageRow | null>(null);
    const [editingRow, setEditingRow] = useState<InviteMessageRow | null>(null);
    const [editMessage, setEditMessage] = useState('');
    const [imageData, setImageData] = useState('');
    const [imageName, setImageName] = useState('');
    const [nowMs, setNowMs] = useState(() => Date.now());
    const requestIdRef = useRef(0);

    const loadRows = useCallback(async () => {
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
            const response = await vrchatToolsRepository.getInviteMessages({
                currentUserId,
                messageType: resolvedMessageType
            });
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
    }, [currentUserId, resolvedMessageType, t]);

    useEffect(() => {
        loadRows();
        return () => {
            requestIdRef.current += 1;
        };
    }, [currentUserId, endpoint, loadRows, resolvedMessageType]);

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

    async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
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

    function beginEdit(row: InviteMessageRow) {
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

    async function saveMessage(row: InviteMessageRow, message: string) {
        const save = onSave || saveInviteMessage;
        await save({
            currentUserId,
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

    async function applyRow(
        row: InviteMessageRow,
        message: string = row.message || ''
    ) {
        if (!row || sending) {
            return;
        }
        const nextMessage =
            resolvedMode === 'respond' ? message.trim() : message;
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
                        onChange={(event) => {
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
            <div className="app-data-table min-h-0 flex-1 overflow-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <DataTableHeaderRow>
                            <DataTableHead
                                className={`w-20 ${DATA_TABLE_NUMERIC_HEADER_CLASS_NAME}`}
                            >
                                {t('table.profile.invite_messages.slot')}
                            </DataTableHead>
                            <DataTableHead>
                                {t('table.profile.invite_messages.message')}
                            </DataTableHead>
                            <DataTableHead className="w-32 text-right">
                                {t('table.profile.invite_messages.cool_down')}
                            </DataTableHead>
                            {showActionColumn ? (
                                <DataTableHead className="w-28 text-right">
                                    {t('table.profile.invite_messages.action')}
                                </DataTableHead>
                            ) : null}
                        </DataTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <DataTableRow>
                                <DataTableCell
                                    colSpan={showActionColumn ? 4 : 3}
                                    className="text-muted-foreground h-24 text-center"
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <Spinner data-icon="inline-start" />
                                        {t('common.loading')}
                                    </span>
                                </DataTableCell>
                            </DataTableRow>
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
                                    <DataTableRow
                                        key={`${resolvedMessageType}:${row.slot}`}
                                        data-state={
                                            selected ? 'selected' : undefined
                                        }
                                    >
                                        <DataTableCell
                                            className={`${DATA_TABLE_NUMERIC_CELL_CLASS_NAME} font-mono text-xs`}
                                        >
                                            {row.slot}
                                        </DataTableCell>
                                        <DataTableCell className="whitespace-normal">
                                            {row.message || '-'}
                                        </DataTableCell>
                                        <DataTableCell className="text-muted-foreground text-right text-xs">
                                            {cooldownLabel || '-'}
                                        </DataTableCell>
                                        {showActionColumn ? (
                                            <DataTableCell
                                                className={`${DATA_TABLE_CONTROL_CELL_CLASS_NAME} text-right`}
                                            >
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
                                                                event: MouseEvent<HTMLButtonElement>
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
                                                                event: MouseEvent<HTMLButtonElement>
                                                            ) => {
                                                                event.stopPropagation();
                                                                applyRow(row);
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
                                            </DataTableCell>
                                        ) : null}
                                    </DataTableRow>
                                );
                            })
                        ) : (
                            <DataTableRow>
                                <DataTableCell
                                    colSpan={showActionColumn ? 4 : 3}
                                    className="text-muted-foreground h-24 text-center"
                                >
                                    {t('common.no_data')}
                                </DataTableCell>
                            </DataTableRow>
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
                                onClick={() => {
                                    if (resolvedMode === 'respond') {
                                        applyRow(
                                            editingRow,
                                            editMessage.trim()
                                        );
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
                                applyRow(confirmRow);
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
                    onClick={onClose ?? undefined}
                >
                    {t('common.actions.close')}
                </Button>
            </DialogFooter>
        </div>
    );
}
