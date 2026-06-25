import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';

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
];

export const validModes = new Set(['select', 'manage', 'respond']);

export function normalizeInviteMessageRows(value: any, messageType: any) {
    const rows = Array.isArray(value)
        ? value
        : Array.isArray(value?.messages)
          ? value.messages
          : value && typeof value === 'object'
            ? Object.values(value).filter(
                  (row: any) => row && typeof row === 'object'
              )
            : [];

    return rows
        .map((row: any, index: any) => ({
            ...row,
            slot: Number.parseInt(
                row?.slot ?? row?.messageSlot ?? row?.requestSlot ?? index,
                10
            ),
            message: String(row?.message || row?.text || ''),
            messageType
        }))
        .filter((row: any) => Number.isFinite(row.slot))
        .sort((left: any, right: any) => left.slot - right.slot);
}

export function getInviteCooldownLabel(updatedAt: any, nowMs: any) {
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

export function isInviteMessageOnCooldown(row: any, nowMs: any) {
    return Boolean(getInviteCooldownLabel(rowUpdatedAt(row), nowMs));
}

export function rowUpdatedAt(row: any) {
    return row?.updatedAt || row?.updated_at || '';
}

export function dialogTitle(mode: any, messageType: any, t: any) {
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
    mode: any,
    messageType: any,
    _targetLabel: any,
    t: any
) {
    if (mode === 'manage') {
        return t('view.tools.other.edit_invite_message_description');
    }
    if (mode === 'respond') {
        return t('dialog.edit_send_invite_response_message.description');
    }
    return t('dialog.edit_send_invite_message.description');
}

export function primaryActionLabel(mode: any, messageType: any, t: any) {
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
    endpoint,
    messageType,
    row,
    message,
    t
}: any) {
    const slot = Number.parseInt(row?.slot, 10);
    if (!currentUserId || !Number.isFinite(slot)) {
        throw new Error(
            t('dialog.edit_invite_messages.description.slot_must_be_number')
        );
    }

    const previousMessage = String(row?.message || '');
    if (message === previousMessage) {
        return null;
    }

    const json = await vrchatToolsRepository.editInviteMessage(
        {
            currentUserId,
            messageType,
            slot,
            message
        },
        { endpoint }
    );
    if (json?.[slot]?.message === previousMessage) {
        throw new Error(t('dialog.edit_invite_messages.error.update_failed'));
    }
    return json;
}
