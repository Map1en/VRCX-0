import { ImageIcon, RefreshCcwIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { InviteMessageType } from '@/platform/tauri/bindings';
import { IMAGE_UPLOAD_ACCEPT } from '@/shared/constants/imageUpload';
import {
    readFileAsBase64,
    validateImageUploadFile
} from '@/shared/utils/imageUpload';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    INVITE_MESSAGE_TYPES,
    inviteMessageActionLabel,
    inviteMessageDialogTitle,
    isInviteMessageType,
    type InviteMessageUsePayload
} from './invite-message/inviteMessageData';
import { InviteMessageList } from './invite-message/InviteMessageList';
import {
    useInviteMessages,
    type InviteMessagesState
} from './invite-message/useInviteMessages';

type InviteMessageDialogProps = {
    open?: boolean;
    onOpenChange?: ((open: boolean) => void) | null;
    currentUserId?: string | null;
    endpoint?: string | null;
    messageType?: InviteMessageType | null;
    targetLabel?: string | null;
    allowEdit?: boolean;
    allowImageUpload?: boolean;
    onUse?:
        | ((
              payload: InviteMessageUsePayload
          ) => boolean | void | Promise<boolean | void>)
        | null;
};

type InviteMessageTemplatesDialogProps = {
    open?: boolean;
    onOpenChange?: ((open: boolean) => void) | null;
    currentUserId?: string | null;
    endpoint?: string | null;
};

function RefreshButton({ messages }: { messages: InviteMessagesState }) {
    const { t } = useTranslation();
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-10"
            disabled={messages.loading}
            aria-label={t('common.actions.refresh')}
            onClick={() => {
                messages.reload();
            }}
        >
            <RefreshCcwIcon />
        </Button>
    );
}

function InviteMessagePickContent({
    currentUserId,
    endpoint,
    messageType,
    targetLabel,
    allowEdit,
    allowImageUpload,
    onUse,
    onClose
}: Omit<InviteMessageDialogProps, 'open' | 'onOpenChange' | 'messageType'> & {
    messageType: InviteMessageType;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const messages = useInviteMessages({
        currentUserId,
        endpoint,
        messageType
    });
    const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
    const [imageData, setImageData] = useState('');
    const [imageName, setImageName] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const selectedRow =
        messages.rows.find((row) => row.slot === selectedSlot) ?? null;
    const requiresMessage =
        messageType === 'response' || messageType === 'requestResponse';

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

    async function send() {
        if (!selectedRow || sending) {
            return;
        }
        if (requiresMessage && !selectedRow.message.trim()) {
            setError(t('dialog.invite_message.error.message_required'));
            return;
        }
        setSending(true);
        setError('');
        try {
            const result = await onUse?.({
                row: selectedRow,
                messageType,
                message: selectedRow.message,
                imageData
            });
            if (result !== false) {
                onClose();
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

    const actionLabel = inviteMessageActionLabel(messageType, t);

    return (
        <>
            <DialogHeader className="pr-16">
                <DialogTitle>
                    {inviteMessageDialogTitle(messageType, t)}
                </DialogTitle>
                <DialogDescription>
                    {[
                        targetLabel
                            ? `${t('dialog.invite_message.label.target')} ${targetLabel}`
                            : '',
                        allowEdit
                            ? t('dialog.edit_send_invite_message.description')
                            : ''
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </DialogDescription>
            </DialogHeader>
            <RefreshButton messages={messages} />
            <div className="min-h-0 overflow-y-auto">
                <InviteMessageList
                    messages={messages}
                    allowEdit={allowEdit}
                    disabled={sending}
                    selectedSlot={selectedSlot}
                    onSelect={(row) => {
                        setSelectedSlot(row.slot);
                        setError('');
                    }}
                    onSaved={(row) => setSelectedSlot(row.slot)}
                />
            </div>
            {error ? (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}
            <DialogFooter className="items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    {allowImageUpload ? (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={IMAGE_UPLOAD_ACCEPT}
                                className="hidden"
                                onChange={(event) => {
                                    handleImageChange(event);
                                }}
                            />
                            {imageName ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="min-w-0"
                                    disabled={sending}
                                    aria-label={t(
                                        'dialog.invite_message.clear_selected_image'
                                    )}
                                    onClick={() => {
                                        setImageData('');
                                        setImageName('');
                                    }}
                                >
                                    <ImageIcon data-icon="inline-start" />
                                    <span className="truncate">
                                        {imageName}
                                    </span>
                                    <XIcon data-icon="inline-end" />
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={sending}
                                    onClick={() =>
                                        fileInputRef.current?.click()
                                    }
                                >
                                    <ImageIcon data-icon="inline-start" />
                                    {t('dialog.invite_message.attach_image')}
                                </Button>
                            )}
                        </>
                    ) : null}
                </div>
                <Button
                    type="button"
                    disabled={!selectedRow || sending}
                    onClick={() => {
                        send();
                    }}
                >
                    {sending ? <Spinner data-icon="inline-start" /> : null}
                    {selectedRow
                        ? `${actionLabel} · ${t(
                              'dialog.invite_message.slot_value',
                              { value: selectedRow.slot }
                          )}`
                        : actionLabel}
                </Button>
            </DialogFooter>
        </>
    );
}

function InviteMessageDialog({
    open,
    onOpenChange,
    messageType,
    ...props
}: InviteMessageDialogProps) {
    return (
        <Dialog
            open={Boolean(open)}
            onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)}
        >
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
                {open ? (
                    <InviteMessagePickContent
                        {...props}
                        messageType={messageType ?? 'message'}
                        onClose={() => onOpenChange?.(false)}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function InviteMessageTemplatesTab({
    currentUserId,
    endpoint,
    messageType
}: {
    currentUserId?: string | null;
    endpoint?: string | null;
    messageType: InviteMessageType;
}) {
    const messages = useInviteMessages({
        currentUserId,
        endpoint,
        messageType
    });
    return (
        <>
            <RefreshButton messages={messages} />
            <InviteMessageList messages={messages} allowEdit />
        </>
    );
}

function InviteMessageTemplatesDialog({
    open,
    onOpenChange,
    currentUserId,
    endpoint
}: InviteMessageTemplatesDialogProps) {
    const { t } = useTranslation();
    const [activeType, setActiveType] = useState<InviteMessageType>('message');

    useEffect(() => {
        if (!open) {
            setActiveType('message');
        }
    }, [open]);

    return (
        <Dialog open={Boolean(open)} onOpenChange={onOpenChange ?? undefined}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
                <DialogHeader className="pr-16">
                    <DialogTitle>
                        {t('dialog.edit_invite_messages.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.edit_send_invite_message.description')}
                    </DialogDescription>
                </DialogHeader>
                {open ? (
                    <Tabs
                        value={activeType}
                        onValueChange={(value) => {
                            if (isInviteMessageType(value)) {
                                setActiveType(value);
                            }
                        }}
                        className="min-h-0"
                    >
                        <TabsList className="flex-wrap">
                            {INVITE_MESSAGE_TYPES.map((entry) => (
                                <TabsTrigger
                                    key={entry.type}
                                    value={entry.type}
                                >
                                    {t(entry.labelKey)}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <TabsContent
                            value={activeType}
                            className="mt-3 min-h-0 overflow-y-auto"
                        >
                            <InviteMessageTemplatesTab
                                key={activeType}
                                currentUserId={currentUserId}
                                endpoint={endpoint}
                                messageType={activeType}
                            />
                        </TabsContent>
                    </Tabs>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

export { InviteMessageDialog, InviteMessageTemplatesDialog };
