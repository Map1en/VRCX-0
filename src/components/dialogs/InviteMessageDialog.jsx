import {
    ImageIcon,
    PencilIcon,
    RefreshCcwIcon,
    SendIcon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils.js';
import { toolsRepository } from '@/repositories/index.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile
} from '@/shared/utils/imageUpload.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';

const INVITE_MESSAGE_TYPES = [
    { type: 'message', label: 'Invite' },
    { type: 'request', label: 'Request Invite' },
    { type: 'requestResponse', label: 'Request Invite Response' },
    { type: 'response', label: 'Invite Response' }
];

const validModes = new Set(['select', 'manage', 'respond']);

function normalizeInviteMessageRows(value, messageType) {
    const rows = Array.isArray(value)
        ? value
        : Array.isArray(value?.messages)
          ? value.messages
          : value && typeof value === 'object'
            ? Object.values(value).filter(
                  (row) => row && typeof row === 'object'
              )
            : [];

    return rows
        .map((row, index) => ({
            ...row,
            slot: Number.parseInt(
                row?.slot ?? row?.messageSlot ?? row?.requestSlot ?? index,
                10
            ),
            message: String(row?.message || row?.text || ''),
            messageType
        }))
        .filter((row) => Number.isFinite(row.slot))
        .sort((left, right) => left.slot - right.slot);
}

function getInviteCooldownLabel(updatedAt, nowMs) {
    if (!updatedAt) {
        return '';
    }
    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) {
        return String(updatedAt);
    }
    const remainingMs = updatedTime + 60 * 60 * 1000 - Number(nowMs);
    if (remainingMs <= 0) {
        return '';
    }
    const minutes = Math.ceil(remainingMs / 60000);
    return minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
}

function isInviteMessageOnCooldown(row, nowMs) {
    return Boolean(getInviteCooldownLabel(rowUpdatedAt(row), nowMs));
}

function rowUpdatedAt(row) {
    return row?.updatedAt || row?.updated_at || '';
}

function messageTypeLabel(messageType) {
    return (
        INVITE_MESSAGE_TYPES.find((entry) => entry.type === messageType)
            ?.label || 'Invite'
    );
}

function dialogTitle(mode, messageType) {
    if (mode === 'manage') {
        return 'Message Templates';
    }
    if (mode === 'respond') {
        return messageType === 'requestResponse'
            ? 'Request Invite Response'
            : 'Invite Response';
    }
    return messageType === 'request' ? 'Request With Message' : 'Send With Message';
}

function dialogDescription(mode, messageType, targetLabel) {
    if (mode === 'manage') {
        return 'Edit reusable invite and request message templates.';
    }
    if (mode === 'respond') {
        return `Choose a ${messageTypeLabel(messageType).toLowerCase()} template${targetLabel ? ` for ${targetLabel}` : ''}.`;
    }
    return `Choose a message template${targetLabel ? ` for ${targetLabel}` : ''}.`;
}

function primaryActionLabel(mode, messageType) {
    if (mode === 'manage') {
        return 'Save';
    }
    if (mode === 'select' && messageType === 'request') {
        return 'Request';
    }
    return 'Send';
}

async function saveInviteMessage({
    currentUserId,
    endpoint,
    messageType,
    row,
    message
}) {
    const slot = Number.parseInt(row?.slot, 10);
    if (!currentUserId || !Number.isFinite(slot)) {
        throw new Error('Invite message slot must be a number.');
    }

    const previousMessage = String(row?.message || '');
    if (message === previousMessage) {
        return null;
    }

    const json = await toolsRepository.editInviteMessage(
        {
            currentUserId,
            messageType,
            slot,
            message
        },
        { endpoint }
    );
    if (json?.[slot]?.message === previousMessage) {
        throw new Error('Invite message update failed.');
    }
    return json;
}

function InviteMessagePanel({
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
                'This message template is on cooldown and cannot be edited yet.'
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
            toast.success('Message template updated.');
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

    function handleRowAction(row) {
        if (resolvedMode === 'manage') {
            beginEdit(row);
            return;
        }
        if (resolvedMode === 'respond') {
            setEditingRow(null);
            setConfirmRow(row);
            return;
        }
        void useRow(row);
    }

    const showActionColumn =
        resolvedMode !== 'select' || Boolean(onUse) || allowEdit;
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
                            Clear image: {imageName}
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {targetLabel && resolvedMode !== 'manage' ? (
                <div className="text-muted-foreground text-sm">
                    Target: {targetLabel}
                </div>
            ) : null}
            {error ? <div className="text-destructive text-sm">{error}</div> : null}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-20">Slot</TableHead>
                            <TableHead>Message</TableHead>
                            <TableHead className="w-32 text-right">
                                Cooldown
                            </TableHead>
                            {showActionColumn ? (
                                <TableHead className="w-28 text-right">
                                    Action
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
                                        Loading message templates.
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
                                            'cursor-pointer',
                                            selected && 'bg-muted/70'
                                        )}
                                        tabIndex={0}
                                        aria-label={`Select message template slot ${row.slot}`}
                                        onKeyDown={(event) => {
                                            if (
                                                event.key !== 'Enter' &&
                                                event.key !== ' '
                                            ) {
                                                return;
                                            }
                                            event.preventDefault();
                                            handleRowAction(row);
                                        }}
                                        onClick={() => handleRowAction(row)}
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
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                beginEdit(row);
                                                            }}
                                                        >
                                                            <PencilIcon data-icon="inline-start" />
                                                        </Button>
                                                    ) : null}
                                                    {resolvedMode === 'select' ? (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={sending}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                void useRow(row);
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
                                    No message templates.
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
                        slot <span className="font-mono">{editingRow.slot}</span>
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
                                Cancel
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
                        Send slot{' '}
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
                            Cancel
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
                            Confirm
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
                    Refresh
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    disabled={sending}
                    onClick={onClose}
                >
                    Close
                </Button>
            </DialogFooter>
        </div>
    );
}

function InviteMessageDialog({
    open,
    onOpenChange,
    currentUserId,
    endpoint,
    messageType,
    mode,
    targetLabel,
    allowEdit = false,
    allowImageUpload = false,
    onUse,
    onSave,
    onClose,
    title,
    description
}) {
    const resolvedMode = validModes.has(mode) ? mode : 'select';
    const resolvedMessageType = messageType || 'message';

    function close() {
        onClose?.();
        onOpenChange?.(false);
    }

    return (
        <Dialog
            open={Boolean(open)}
            onOpenChange={(nextOpen) => {
                if (nextOpen) {
                    onOpenChange?.(true);
                } else {
                    close();
                }
            }}
        >
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,56rem)] flex-col">
                <DialogHeader>
                    <DialogTitle>
                        {title || dialogTitle(resolvedMode, resolvedMessageType)}
                    </DialogTitle>
                    <DialogDescription>
                        {description ||
                            dialogDescription(
                                resolvedMode,
                                resolvedMessageType,
                                targetLabel
                            )}
                    </DialogDescription>
                </DialogHeader>
                {open ? (
                    <InviteMessagePanel
                        currentUserId={currentUserId}
                        endpoint={endpoint}
                        messageType={resolvedMessageType}
                        mode={resolvedMode}
                        targetLabel={targetLabel}
                        allowEdit={allowEdit}
                        allowImageUpload={allowImageUpload}
                        onUse={onUse}
                        onSave={onSave}
                        onClose={close}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function InviteMessageTemplatesDialog({
    open,
    onOpenChange,
    currentUserId,
    endpoint
}) {
    const [activeType, setActiveType] = useState('message');

    useEffect(() => {
        if (!open) {
            setActiveType('message');
        }
    }, [open]);

    function close() {
        onOpenChange?.(false);
    }

    return (
        <Dialog open={Boolean(open)} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-[min(92vw,64rem)] flex-col">
                <DialogHeader>
                    <DialogTitle>Message Templates</DialogTitle>
                    <DialogDescription>
                        Edit reusable invite and request message templates.
                    </DialogDescription>
                </DialogHeader>
                {open ? (
                    <Tabs
                        value={activeType}
                        onValueChange={setActiveType}
                        className="min-h-0"
                    >
                        <TabsList className="flex-wrap">
                            {INVITE_MESSAGE_TYPES.map((entry) => (
                                <TabsTrigger key={entry.type} value={entry.type}>
                                    {entry.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <TabsContent value={activeType} className="mt-3">
                            <InviteMessagePanel
                                currentUserId={currentUserId}
                                endpoint={endpoint}
                                messageType={activeType}
                                mode="manage"
                                targetLabel=""
                                allowEdit
                                allowImageUpload={false}
                                onUse={null}
                                onSave={null}
                                onClose={close}
                            />
                        </TabsContent>
                    </Tabs>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

export {
    INVITE_MESSAGE_TYPES,
    InviteMessageDialog,
    InviteMessagePanel,
    InviteMessageTemplatesDialog,
    getInviteCooldownLabel,
    normalizeInviteMessageRows
};
