import { Location } from '@/components/Location.jsx';
import { cn } from '@/lib/utils.js';
import { parseLocation } from '@/shared/utils/location.js';

import { normalizeFeedId as normalizeId } from '../feedRows.js';

function FeedLocationLink({
    location = '',
    worldName = '',
    groupName = '',
    loadingHistoryKey = '',
    endpoint = '',
    onOpenPreviousInstances,
    onNewInstance,
    disableTooltip = false,
    wrapperClassName = '',
    className = ''
}) {
    const normalizedLocation = normalizeId(location);
    const parsedLocation = parseLocation(normalizedLocation);
    const worldTarget = parsedLocation.worldId || '';

    return (
        <span className={cn('block min-w-0', wrapperClassName)}>
            <Location
                location={normalizedLocation || worldTarget}
                hint={worldName}
                grouphint={groupName}
                endpoint={endpoint}
                enableContextMenu
                showLaunchActions
                disableTooltip={disableTooltip}
                previousInstancesDisabled={
                    !worldTarget || loadingHistoryKey === normalizedLocation
                }
                onShowPreviousInstances={
                    onOpenPreviousInstances
                        ? (payload) =>
                              onOpenPreviousInstances({
                                  ...payload,
                                  location:
                                      normalizedLocation || payload.location,
                                  worldId: worldTarget || payload.worldId,
                                  worldName: worldName || payload.worldName,
                                  groupName: groupName || payload.groupName
                              })
                        : undefined
                }
                onNewInstance={
                    onNewInstance
                        ? (payload) =>
                              onNewInstance({
                                  ...payload,
                                  location:
                                      normalizedLocation || payload.location,
                                  worldId: worldTarget || payload.worldId,
                                  worldName: worldName || payload.worldName
                              })
                        : undefined
                }
                className={cn(
                    'text-muted-foreground max-w-full text-sm',
                    className
                )}
            />
        </span>
    );
}

export { FeedLocationLink };
