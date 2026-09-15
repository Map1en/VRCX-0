import { normalizeString } from './string';

const FRIEND_STATUSES = [
    'join me',
    'active',
    'ask me',
    'busy',
    'offline'
] as const;

type FriendStatus = (typeof FRIEND_STATUSES)[number];

const USER_STATUS_INDICATOR_CLASS_NAMES: Readonly<
    Record<FriendStatus, string>
> = Object.freeze({
    active: 'user-status-indicator online',
    'join me': 'user-status-indicator joinme',
    'ask me': 'user-status-indicator askme',
    busy: 'user-status-indicator busy',
    offline: 'user-status-indicator offline'
});

const SOLID_USER_STATUS_DOT_CLASS_NAMES: Readonly<
    Record<FriendStatus, string>
> = Object.freeze({
    active: `${USER_STATUS_INDICATOR_CLASS_NAMES.active} bg-[var(--status-online)]`,
    'join me': `${USER_STATUS_INDICATOR_CLASS_NAMES['join me']} bg-[var(--status-joinme)]`,
    'ask me': `${USER_STATUS_INDICATOR_CLASS_NAMES['ask me']} bg-[var(--status-askme)]`,
    busy: `${USER_STATUS_INDICATOR_CLASS_NAMES.busy} bg-[var(--status-busy)]`,
    offline: `${USER_STATUS_INDICATOR_CLASS_NAMES.offline} bg-[var(--status-offline)]`
});

function isFriendStatus(value: string): value is FriendStatus {
    return FRIEND_STATUSES.some((status) => status === value);
}

function normalizeUserStatus(value: unknown): string {
    const status = normalizeString(value).toLowerCase();
    if (status === 'joinme') {
        return 'join me';
    }
    if (status === 'askme') {
        return 'ask me';
    }
    if (status === 'offline:offline' || status.startsWith('offline ')) {
        return 'offline';
    }
    return status;
}

function userStatusFromValue(value: unknown): FriendStatus | '' {
    const status = normalizeUserStatus(value);
    return isFriendStatus(status) ? status : '';
}

function sortStatus(
    a: FriendStatus | string,
    b: FriendStatus | string
): number {
    switch (b) {
        case 'join me':
            switch (a) {
                case 'active':
                case 'ask me':
                case 'busy':
                case 'offline':
                    return 1;
            }
            break;
        case 'active':
            switch (a) {
                case 'join me':
                    return -1;
                case 'ask me':
                case 'busy':
                case 'offline':
                    return 1;
            }
            break;
        case 'ask me':
            switch (a) {
                case 'join me':
                case 'active':
                    return -1;
                case 'busy':
                case 'offline':
                    return 1;
            }
            break;
        case 'busy':
            switch (a) {
                case 'join me':
                case 'active':
                case 'ask me':
                    return -1;
                case 'offline':
                    return 1;
            }
            break;
        case 'offline':
            switch (a) {
                case 'join me':
                case 'active':
                case 'ask me':
                case 'busy':
                    return -1;
            }
            break;
    }
    return 0;
}

export {
    SOLID_USER_STATUS_DOT_CLASS_NAMES,
    USER_STATUS_INDICATOR_CLASS_NAMES,
    normalizeUserStatus,
    sortStatus,
    userStatusFromValue
};
