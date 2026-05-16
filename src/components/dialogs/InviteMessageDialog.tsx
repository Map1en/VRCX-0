// @ts-nocheck
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
} from './invite-message/InviteMessagePanel';

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
    const { t } = useTranslation();
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
                        onValueChange={setActiveType}
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

export {
    INVITE_MESSAGE_TYPES,
    InviteMessageDialog,
    InviteMessagePanel,
    InviteMessageTemplatesDialog,
    getInviteCooldownLabel,
    normalizeInviteMessageRows
};
