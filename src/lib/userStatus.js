function normalizePresenceText(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
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

function normalizeUserStatus(value) {
    if (typeof value === 'string') {
        return normalizePresenceText(value);
    }
    const source = value?.ref && typeof value.ref === 'object' ? value.ref : value;
    if (value?.pendingOffline || source?.pendingOffline) {
        return 'offline';
    }
    const lastLocation = value?.lastLocation || value?.last_location || value?.$lastLocation || source?.lastLocation || source?.last_location || source?.$lastLocation;
    const status = normalizePresenceText(value?.status || source?.status);
    const state = normalizePresenceText(value?.stateBucket || value?.state || source?.stateBucket || source?.state);
    const location = normalizePresenceText(
        value?.location ||
            value?.$location?.tag ||
            value?.$locationTag ||
            source?.location ||
            source?.$location?.tag ||
            source?.$locationTag ||
            (typeof lastLocation === 'string' ? lastLocation : lastLocation?.location || lastLocation?.tag || lastLocation?.$location?.tag)
    );
    if (state === 'offline' || status === 'offline' || location === 'offline') {
        return 'offline';
    }
    if (!status && !state && (location === 'private' || location === 'traveling')) {
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

function userStatusDotClassName(value) {
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

function userStatusIndicatorClassName(value, { showOffline = false, className = '' } = {}) {
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

function userStatusSortRank(value) {
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

export { normalizeUserStatus, userStatusDotClassName, userStatusIndicatorClassName, userStatusSortRank };
