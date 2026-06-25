import { Location } from '@/components/Location';
import { cn } from '@/lib/utils';
import { parseLocation } from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';

import { normalizeFeedId as normalizeId } from '../feedRows';
import type { FeedLocationActionPayload } from '../feedTypes';

type FeedLocationLinkProps = {
    className?: string;
    disableTooltip?: boolean;
    groupName?: unknown;
    loadingHistoryKey?: string;
    location?: unknown;
    onNewInstance?(payload?: FeedLocationActionPayload): void;
    onOpenPreviousInstances?(payload?: FeedLocationActionPayload): void;
    worldName?: unknown;
    wrapperClassName?: string;
};

function FeedLocationLink({
    className = '',
    disableTooltip = false,
    groupName = '',
    loadingHistoryKey = '',
    location = '',
    onNewInstance,
    onOpenPreviousInstances,
    worldName = '',
    wrapperClassName = ''
}: FeedLocationLinkProps) {
    const endpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
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
                        ? (payload: FeedLocationActionPayload) =>
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
                        ? (payload: FeedLocationActionPayload) =>
                              onNewInstance({
                                  ...payload,
                                  location:
                                      normalizedLocation || payload.location,
                                  worldId: worldTarget || payload.worldId,
                                  worldName: worldName || payload.worldName,
                                  groupName: groupName || payload.groupName
                              })
                        : undefined
                }
                className={cn(
                    'text-foreground [&_button:hover]:text-foreground max-w-full text-sm',
                    className
                )}
            />
        </span>
    );
}

export { FeedLocationLink };
