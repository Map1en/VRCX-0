import { toolsRepository } from '@/repositories/index.js';

export const INVITE_MESSAGE_TYPES = [
    { type: 'message', label: 'Invite' },
    { type: 'request', label: 'Request Invite' },
    { type: 'requestResponse', label: 'Request Invite Response' },
    { type: 'response', label: 'Invite Response' }
];

export const validModes = new Set(['select', 'manage', 'respond']);

export function normalizeInviteMessageRows(value, messageType) {
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

export function getInviteCooldownLabel(updatedAt, nowMs) {
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

export function isInviteMessageOnCooldown(row, nowMs) {
    return Boolean(getInviteCooldownLabel(rowUpdatedAt(row), nowMs));
}

export function rowUpdatedAt(row) {
    return row?.updatedAt || row?.updated_at || '';
}

export function messageTypeLabel(messageType) {
    return (
        INVITE_MESSAGE_TYPES.find((entry) => entry.type === messageType)
            ?.label || 'Invite'
    );
}

export function dialogTitle(mode, messageType) {
    if (mode === 'manage') {
        return 'Message Templates';
    }
    if (mode === 'respond') {
        return messageType === 'requestResponse'
            ? 'Request Invite Response'
            : 'Invite Response';
    }
    return messageType === 'request'
        ? 'Request With Message'
        : 'Send With Message';
}

export function dialogDescription(mode, messageType, targetLabel) {
    if (mode === 'manage') {
        return 'Edit reusable invite and request message templates.';
    }
    if (mode === 'respond') {
        return `Choose a ${messageTypeLabel(messageType).toLowerCase()} template${targetLabel ? ` for ${targetLabel}` : ''}.`;
    }
    return `Choose a message template${targetLabel ? ` for ${targetLabel}` : ''}.`;
}

export function primaryActionLabel(mode, messageType) {
    if (mode === 'manage') {
        return 'Save';
    }
    if (mode === 'select' && messageType === 'request') {
        return 'Request';
    }
    return 'Send';
}

export async function saveInviteMessage({
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
