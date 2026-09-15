import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { InviteMessageType } from '@/platform/tauri/bindings';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    INVITE_MESSAGE_TYPES,
    InviteMessagePanel,
    dialogDescription,
    dialogTitle,
    isInviteMessageType,
    type InviteMessageMode,
    type InviteMessageSavePayload,
    type InviteMessageUsePayload
} from './invite-message/InviteMessagePanel';

type InviteMessageDialogProps = {
    open?: boolean;
    onOpenChange?: ((open: boolean) => void) | null;
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
    title?: ReactNode;
    description?: ReactNode;
};

type InviteMessageTemplatesDialogProps = {
    open?: boolean;
    onOpenChange?: ((open: boolean) => void) | null;
    currentUserId?: string | null;
    endpoint?: string | null;
};

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
}: InviteMessageDialogProps) {
    const { t } = useTranslation();
    const resolvedMode = mode ?? 'select';
    const resolvedMessageType = messageType ?? 'message';

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
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[min(92vw,56rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {title ||
                            dialogTitle(resolvedMode, resolvedMessageType, t)}
                    </DialogTitle>
                    <DialogDescription>
                        {description ||
                            dialogDescription(
                                resolvedMode,
                                resolvedMessageType,
                                targetLabel,
                                t
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
}: InviteMessageTemplatesDialogProps) {
    const { t } = useTranslation();

    const [activeType, setActiveType] = useState<InviteMessageType>('message');

    useEffect(() => {
        if (!open) {
            setActiveType('message');
        }
    }, [open]);

    function close() {
        onOpenChange?.(false);
    }

    return (
        <Dialog open={Boolean(open)} onOpenChange={onOpenChange ?? undefined}>
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[min(92vw,64rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.edit_invite_messages.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('view.tools.other.edit_invite_message_description')}
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

export { InviteMessageDialog, InviteMessageTemplatesDialog };
