import vrchatToolsRepository, {
    type InviteMessageRecord
} from '@/repositories/vrchatToolsRepository';
import { HOUR_MS, MINUTE_MS } from '@/shared/constants/time';

export type InviteMessageMode = 'select' | 'manage' | 'respond';

export type InviteMessageRow = InviteMessageRecord & {
    message: string;
    messageType: string;
    slot: number;
};

export type InviteMessageUsePayload = {
    row: InviteMessageRow;
    messageType: string;
    message: string;
    imageData: string;
};

export type InviteMessageSavePayload = {
    currentUserId?: string | null;
    messageType: string;
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

export const validModes = new Set<InviteMessageMode>([
    'select',
    'manage',
    'respond'
]);

export function isInviteMessageMode(
    value: unknown
): value is InviteMessageMode {
    return value === 'select' || value === 'manage' || value === 'respond';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
    messageType: string
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

export function getInviteCooldownLabel(updatedAt: unknown, nowMs: unknown) {
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
    const remainingMs = updatedTime + HOUR_MS - Number(nowMs);
    if (remainingMs <= 0) {
        return '';
    }
    const minutes = Math.ceil(remainingMs / MINUTE_MS);
    return minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${minutes}m`;
}

export function isInviteMessageOnCooldown(
    row: InviteMessageRow,
    nowMs: unknown
) {
    return Boolean(getInviteCooldownLabel(rowUpdatedAt(row), nowMs));
}

export function rowUpdatedAt(row: InviteMessageRow) {
    return row.updatedAt || row.updated_at || '';
}

export function dialogTitle(
    mode: InviteMessageMode,
    messageType: string,
    t: Translate
) {
    if (mode === 'manage') {
        return t('dialog.edit_invite_messages.header');
    }
    if (mode === 'respond') {
        return messageType === 'requestResponse'
            ? t('dialog.invite_request_response_message.header')
            : t('dialog.invite_response_message.header');
    }
    return messageType === 'request'
        ? t('dialog.invite_request_message.header')
        : t('dialog.invite_message.header');
}

export function dialogDescription(
    mode: InviteMessageMode,
    messageType: string,
    _targetLabel: unknown,
    t: Translate
) {
    if (mode === 'manage') {
        return t('view.tools.other.edit_invite_message_description');
    }
    if (mode === 'respond') {
        return t('dialog.edit_send_invite_response_message.description');
    }
    return t('dialog.edit_send_invite_message.description');
}

export function primaryActionLabel(
    mode: InviteMessageMode,
    messageType: string,
    t: Translate
) {
    if (mode === 'manage') {
        return t('dialog.edit_invite_message.save');
    }
    if (mode === 'select' && messageType === 'request') {
        return t('dialog.user.actions.request_invite');
    }
    return t('dialog.edit_send_invite_message.send');
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
