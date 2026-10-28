import { CheckIcon, ChevronDownIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { InviteMessageType } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';

import { InviteMessageTemplatesDialog } from '../InviteMessageDialog';
import { InviteMessageList } from './InviteMessageList';
import { useInviteMessages } from './useInviteMessages';

type InviteMessagePickerProps = {
    currentUserId?: string | null;
    endpoint?: string | null;
    messageType?: InviteMessageType;
    value: number | null;
    disabled?: boolean;
    onChange: (slot: number | null) => void;
};

export function InviteMessagePicker({
    currentUserId,
    endpoint,
    messageType = 'message',
    value,
    disabled = false,
    onChange
}: InviteMessagePickerProps) {
    const { t } = useTranslation();
    const messages = useInviteMessages({
        currentUserId,
        endpoint,
        messageType
    });
    const [open, setOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const selectedRow =
        value === null
            ? null
            : (messages.rows.find((row) => row.slot === value) ?? null);
    const label =
        value === null
            ? t('dialog.invite_message.no_message')
            : selectedRow?.message ||
              t('dialog.invite_message.slot_value', { value });

    function pick(slot: number | null) {
        onChange(slot);
        setOpen(false);
    }

    return (
        <>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    render={
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="max-w-64 min-w-0"
                            disabled={disabled}
                        />
                    }
                >
                    <span className="truncate">{label}</span>
                    {value !== null ? (
                        <span className="text-muted-foreground font-mono text-xs">
                            #{value}
                        </span>
                    ) : null}
                    <ChevronDownIcon data-icon="inline-end" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 gap-1 p-1">
                    <button
                        type="button"
                        data-selected={value === null || undefined}
                        className="hover:bg-accent/50 data-selected:bg-accent flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors outline-none"
                        onClick={() => pick(null)}
                    >
                        <span className="w-5 shrink-0" />
                        <span className="text-muted-foreground min-w-0 flex-1">
                            {t('dialog.invite_message.no_message')}
                        </span>
                        <span className="flex w-4 shrink-0 items-center">
                            {value === null ? (
                                <CheckIcon className="size-4" />
                            ) : null}
                        </span>
                    </button>
                    <div className="max-h-72 overflow-y-auto">
                        <InviteMessageList
                            messages={messages}
                            compact
                            selectedSlot={value}
                            onSelect={(row) => pick(row.slot)}
                        />
                    </div>
                    <div className="border-t pt-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground w-full justify-start"
                            onClick={() => {
                                setOpen(false);
                                setManageOpen(true);
                            }}
                        >
                            <SettingsIcon data-icon="inline-start" />
                            {t('dialog.edit_invite_messages.header')}
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
            <InviteMessageTemplatesDialog
                open={manageOpen}
                onOpenChange={(nextOpen) => {
                    setManageOpen(nextOpen);
                    if (!nextOpen) {
                        messages.reload();
                    }
                }}
                currentUserId={currentUserId}
                endpoint={endpoint}
            />
        </>
    );
}
