import { LocationDisplay } from '@/components/location/LocationDisplay';
import { useResolvedLocation } from '@/components/location/useResolvedLocation';
import { openGroupDialog } from '@/services/dialogService';
import { normalizeString } from '@/shared/utils/string';

type StaticLocationProps = {
    location?: unknown;
    traveling?: unknown;
    hint?: unknown;
    grouphint?: unknown;
    groupHint?: unknown;
    endpoint?: unknown;
    disableTooltip?: boolean;
    showInstanceIdInLocation?: boolean;
    showGroupLink?: boolean;
    className?: string;
    worldNameClassName?: string;
};

export function StaticLocation({
    location = '',
    traveling,
    hint = '',
    grouphint = '',
    groupHint = '',
    endpoint = '',
    disableTooltip = false,
    showInstanceIdInLocation,
    showGroupLink = true,
    className = '',
    worldNameClassName = ''
}: StaticLocationProps) {
    const {
        parsedLocation,
        region,
        instanceName,
        isClosed,
        groupName,
        worldName,
        worldNameHint,
        isTraveling,
        isAgeRestricted,
        text,
        tooltipContent,
        shouldShowInstanceId
    } = useResolvedLocation({
        location,
        traveling,
        hint,
        grouphint,
        groupHint,
        endpoint,
        showInstanceIdInLocation
    });

    function openGroup(event: any) {
        event?.stopPropagation?.();
        const groupId = normalizeString(parsedLocation.groupId);
        if (!groupId) {
            return;
        }
        openGroupDialog({ groupId, title: groupName || undefined });
    }

    return (
        <LocationDisplay
            asButton={false}
            className={className}
            disableTooltip={disableTooltip}
            groupName={groupName}
            instanceName={instanceName}
            isAgeRestricted={isAgeRestricted}
            isClosed={isClosed}
            isLocationLink={false}
            isTraveling={isTraveling}
            onOpenGroup={openGroup}
            region={region}
            shouldShowInstanceId={shouldShowInstanceId}
            showGroupLink={showGroupLink}
            strict={parsedLocation.strict}
            text={text}
            tooltipContent={tooltipContent}
            worldName={worldNameHint || worldName}
            worldNameClassName={worldNameClassName}
        />
    );
}
