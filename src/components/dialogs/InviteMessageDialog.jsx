import { useEffect, useState } from 'react';

import { useTranslation } from 'react-i18next';
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
    getInviteCooldownLabel,
    normalizeInviteMessageRows
} from './invite-message/InviteMessagePanel.jsx';

const validModes = new Set(['select', 'manage', 'respond']);

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
    const { t } = useTranslation();

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
                    <DialogTitle>
                        {t(
                            'dialog.invite_message.generated.message_templates'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'dialog.invite_message.generated.edit_reusable_invite_and_request_message_templates'
                        )}
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
