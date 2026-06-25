type UserStatusSource = Record<string, unknown>;

type UserStatusIndicatorOptions = {
    showOffline?: boolean;
    className?: string;
};

type TranslateFn = (
    key: string,
    options?: {
        defaultValue: string;
    }
) => string;

function asUserStatusSource(value: unknown): UserStatusSource {
    return value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

function normalizePresenceText(value: unknown) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (normalized === 'joinme') {
        return 'join me';
    }
    if (normalized === 'askme') {
        return 'ask me';
    }
    if (normalized === 'offline:offline' || normalized.startsWith('offline ')) {
        return 'offline';
    }
    if (normalized === 'private:private') {
        return 'private';
    }
    if (normalized === 'traveling:traveling') {
        return 'traveling';
    }
    return normalized;
}

function normalizeUserStatus(value: unknown) {
    if (typeof value === 'string') {
        return normalizePresenceText(value);
    }
    const record = asUserStatusSource(value);
    const source = asUserStatusSource(
        record.ref && typeof record.ref === 'object' ? record.ref : record
    );
    if (record.pendingOffline || source?.pendingOffline) {
        return 'offline';
    }
    const lastLocation =
        record.lastLocation ||
        record.last_location ||
        record.$lastLocation ||
        source?.lastLocation ||
        source?.last_location ||
        source?.$lastLocation;
    const recordLocation = asUserStatusSource(record.$location);
    const sourceLocation = asUserStatusSource(source.$location);
    const lastLocationRecord = asUserStatusSource(lastLocation);
    const status = normalizePresenceText(record.status || source?.status);
    const state = normalizePresenceText(
        record.stateBucket ||
            record.state ||
            source?.stateBucket ||
            source?.state
    );
    const location = normalizePresenceText(
        record.location ||
            recordLocation.tag ||
            record.$locationTag ||
            source?.location ||
            sourceLocation.tag ||
            source?.$locationTag ||
            (typeof lastLocation === 'string'
                ? lastLocation
                : lastLocationRecord.location ||
                  lastLocationRecord.tag ||
                  asUserStatusSource(lastLocationRecord.$location).tag)
    );
    if (state === 'offline' || status === 'offline' || location === 'offline') {
        return 'offline';
    }
    if (
        !status &&
        !state &&
        (location === 'private' || location === 'traveling')
    ) {
        return location;
    }
    if (status === 'join me') {
        return 'join me';
    }
    if (status === 'ask me') {
        return 'ask me';
    }
    if (status === 'busy') {
        return 'busy';
    }
    if (state === 'active') {
        return 'state-active';
    }
    if (state === 'online') {
        return 'active';
    }
    if (status === 'active') {
        return 'active';
    }
    if (location.startsWith('wrld_')) {
        return 'active';
    }
    return status || state;
}

function userStatusDotClassName(value: unknown) {
    const status = normalizeUserStatus(value);
    if (status === 'state-active') {
        return 'bg-[var(--status-active)]';
    }
    if (status === 'active') {
        return 'bg-[var(--status-online)]';
    }
    if (status === 'join me') {
        return 'bg-[var(--status-joinme)]';
    }
    if (status === 'ask me') {
        return 'bg-[var(--status-askme)]';
    }
    if (status === 'busy') {
        return 'bg-[var(--status-busy)]';
    }
    if (status === 'offline') {
        return 'bg-[var(--status-offline)]';
    }
    return '';
}

function userStatusIndicatorClassName(
    value: unknown,
    { showOffline = false, className = '' }: UserStatusIndicatorOptions = {}
) {
    const status = normalizeUserStatus(value);
    const classes = ['x-user-status'];

    if (status === 'state-active') {
        classes.push('active');
    } else if (status === 'active') {
        classes.push('online');
    } else if (status === 'join me') {
        classes.push('joinme');
    } else if (status === 'ask me') {
        classes.push('askme');
    } else if (status === 'busy') {
        classes.push('busy');
    } else if (showOffline && status === 'offline') {
        classes.push('offline');
    } else {
        return '';
    }

    if (className) {
        classes.push(className);
    }

    return classes.join(' ');
}

function userStatusSortRank(value: unknown) {
    const status = normalizeUserStatus(value);
    if (status === 'join me') {
        return 0;
    }
    if (status === 'active') {
        return 1;
    }
    if (status === 'state-active') {
        return 4;
    }
    if (status === 'ask me') {
        return 2;
    }
    if (status === 'busy') {
        return 3;
    }
    if (status === 'offline') {
        return 5;
    }
    if (status === 'private' || status === 'traveling') {
        return 4;
    }
    return 4;
}

const statusLabelKeys: Readonly<Record<string, string>> = Object.freeze({
    active: 'dialog.user.status.online',
    'state-active': 'dialog.user.status.active',
    'join me': 'dialog.user.status.join_me',
    'ask me': 'dialog.user.status.ask_me',
    busy: 'dialog.user.status.busy',
    offline: 'dialog.user.status.offline',
    private: 'location.private',
    traveling: 'location.traveling'
});

const statusLabelFallbacks: Readonly<Record<string, string>> = Object.freeze({
    active: 'Online',
    'state-active': 'Active',
    'join me': 'Join Me',
    'ask me': 'Ask Me',
    busy: 'Do Not Disturb',
    offline: 'Offline',
    private: 'Private',
    traveling: 'Traveling'
});

function userStatusLabel(value: unknown, t?: TranslateFn) {
    const status = normalizeUserStatus(value);
    if (!status) {
        return '';
    }
    const labelKey = statusLabelKeys[status];
    const fallback = statusLabelFallbacks[status] || status;
    if (!labelKey || typeof t !== 'function') {
        return fallback;
    }
    return t(labelKey, { defaultValue: fallback });
}

export {
    normalizeUserStatus,
    userStatusDotClassName,
    userStatusIndicatorClassName,
    userStatusLabel,
    userStatusSortRank
};
