import { timeToText } from '@/lib/dateTime';
import type { InviteMessageType } from '@/platform/tauri/bindings';
import vrchatToolsRepository, {
    type InviteMessageRecord
} from '@/repositories/vrchatToolsRepository';
import { HOUR_MS, MINUTE_MS } from '@/shared/constants/time';
import { isRecord } from '@/shared/utils/record';

export type InviteMessageRow = InviteMessageRecord & {
    message: string;
    messageType: InviteMessageType;
    slot: number;
};

export type InviteMessageUsePayload = {
    row: InviteMessageRow;
    messageType: InviteMessageType;
    message: string;
    imageData: string;
};

type InviteMessageSavePayload = {
    currentUserId?: string | null;
    messageType: InviteMessageType;
    row: InviteMessageRow;
    message: string;
    t: Translate;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const INVITE_MESSAGE_TYPES = [
    {
        type: 'message',
        labelKey: 'dialog.edit_invite_messages.invite_message_tab'
    },
    {
        type: 'request',
        labelKey: 'dialog.edit_invite_messages.invite_request_tab'
    },
    {
        type: 'requestResponse',
        labelKey: 'dialog.edit_invite_messages.invite_request_response_tab'
    },
    {
        type: 'response',
        labelKey: 'dialog.edit_invite_messages.invite_response_tab'
    }
] as const;

export function isInviteMessageType(value: string): value is InviteMessageType {
    return INVITE_MESSAGE_TYPES.some((entry) => entry.type === value);
}

function isInviteMessageRecord(value: unknown): value is InviteMessageRecord {
    return isRecord(value);
}

function inviteMessageSourceRows(value: unknown): InviteMessageRecord[] {
    const rows = Array.isArray(value)
        ? value.filter(isInviteMessageRecord)
        : isRecord(value) && Array.isArray(value.messages)
          ? value.messages.filter(isInviteMessageRecord)
          : isRecord(value)
            ? Object.values(value).filter(isInviteMessageRecord)
            : [];

    return rows;
}

export function normalizeInviteMessageRows(
    value: unknown,
    messageType: InviteMessageType
): InviteMessageRow[] {
    const rows = inviteMessageSourceRows(value);
    return rows
        .map((row, index) => ({
            ...row,
            slot: Number.parseInt(
                String(row.slot ?? row.messageSlot ?? row.requestSlot ?? index),
                10
            ),
            message: String(row.message || row.text || ''),
            messageType
        }))
        .filter((row) => Number.isFinite(row.slot))
        .sort((left, right) => left.slot - right.slot);
}

export function getInviteCooldownLabel(updatedAt: unknown, nowMs: number) {
    if (!updatedAt) {
        return '';
    }
    const updatedTime =
        typeof updatedAt === 'string' ||
        typeof updatedAt === 'number' ||
        updatedAt instanceof Date
            ? new Date(updatedAt).getTime()
            : Number.NaN;
    if (!Number.isFinite(updatedTime)) {
        return String(updatedAt);
    }
    const remainingMs = updatedTime + HOUR_MS - nowMs;
    if (remainingMs <= 0) {
        return '';
    }
    return timeToText(Math.ceil(remainingMs / MINUTE_MS) * MINUTE_MS);
}

export function rowUpdatedAt(row: InviteMessageRow) {
    return row.updatedAt || row.updated_at || '';
}

export function inviteMessageDialogTitle(
    messageType: InviteMessageType,
    t: Translate
) {
    switch (messageType) {
        case 'request':
            return t('dialog.invite_request_message.header');
        case 'response':
            return t('dialog.invite_response_message.header');
        case 'requestResponse':
            return t('dialog.invite_request_response_message.header');
        default:
            return t('dialog.invite_message.header');
    }
}

export function inviteMessageActionLabel(
    messageType: InviteMessageType,
    t: Translate
) {
    return messageType === 'request'
        ? t('dialog.user.actions.request_invite')
        : t('dialog.edit_send_invite_message.send');
}

export async function saveInviteMessage({
    currentUserId,
    messageType,
    row,
    message,
    t
}: InviteMessageSavePayload) {
    const slot = Number.parseInt(String(row.slot), 10);
    if (!currentUserId || !Number.isFinite(slot)) {
        throw new Error(
            t('dialog.edit_invite_messages.description.slot_must_be_number')
        );
    }

    const previousMessage = String(row.message || '');
    if (message === previousMessage) {
        return null;
    }

    const json = await vrchatToolsRepository.editInviteMessage({
        currentUserId,
        messageType,
        slot,
        message
    });
    if (json?.[slot]?.message === previousMessage) {
        throw new Error(t('dialog.edit_invite_messages.error.update_failed'));
    }
    return json;
}
