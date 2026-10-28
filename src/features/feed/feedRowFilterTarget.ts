import type { LogFilterTarget } from '@/components/data-table/LogFilterContextMenu';
import {
    resolveFeedLocationForDisplay,
    resolveFeedUserId
} from '@/components/feed/feedRows';
import type { FeedRow } from '@/components/feed/feedTypes';
import { parseLocation } from '@/shared/utils/location';

const FEED_LOCATION_TYPES = new Set(['GPS', 'Online', 'Offline']);

export function getFeedRowFilterTarget(
    row: FeedRow,
    typeLabel: string,
    userName: string
): LogFilterTarget {
    const type = row.type || '';
    return {
        userId: resolveFeedUserId(row),
        userName,
        type,
        typeLabel,
        worldId: FEED_LOCATION_TYPES.has(type)
            ? parseLocation(resolveFeedLocationForDisplay(row)).worldId
            : '',
        worldName: row.worldName || ''
    };
}
