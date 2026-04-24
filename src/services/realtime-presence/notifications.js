import { configRepository } from '@/repositories/index.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

import { pushSharedFeedNotification } from '../sharedFeedFilterService.js';
import { currentSessionUserId } from './feedWriter.js';
import { firstString, parseStringArray } from './helpers.js';

async function shouldNotifyInstanceClosed() {
    try {
        const filters = parseStringArray(
            await configRepository.getString(
                'VRCX_notificationTableFilters',
                '[]'
            )
        );
        return !filters.length || filters.includes('instance.closed');
    } catch {
        return true;
    }
}

async function handleInstanceClosedEvent(content) {
    const location = firstString(content.instanceLocation, content.location);
    const createdAt = new Date().toISOString();
    const notification = {
        id: `instance.closed:${location || 'unknown'}:${createdAt}`,
        type: 'instance.closed',
        location,
        message: 'Instance Closed',
        createdAt,
        created_at: createdAt
    };
    useVrcNotificationStore.getState().upsertNotification(notification);
    if (await shouldNotifyInstanceClosed()) {
        useShellStore.getState().notifyMenu('notification');
    }
    useFeedLiveStore
        .getState()
        .pushEntry(notification, { ownerUserId: currentSessionUserId() });
    void pushSharedFeedNotification(notification).catch((error) => {
        console.warn(
            'Failed to publish instance-closed shared feed notification:',
            error
        );
    });
    return true;
}

export { handleInstanceClosedEvent, shouldNotifyInstanceClosed };
