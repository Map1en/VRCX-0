import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveLocationTarget } from '@/components/location/locationModel';
import { useLocationMetadata } from '@/components/location/useLocationMetadata';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import {
    getLocationText,
    parseLocation,
    translateAccessType
} from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { usePreferencesStore } from '@/state/preferencesStore';

type UseResolvedLocationParams = {
    location?: unknown;
    traveling?: unknown;
    hint?: unknown;
    grouphint?: unknown;
    groupHint?: unknown;
    endpoint?: unknown;
    link?: boolean;
    showInstanceIdInLocation?: boolean;
};

export function useResolvedLocation({
    location = '',
    traveling,
    hint = '',
    grouphint = '',
    groupHint = '',
    endpoint = '',
    link = false,
    showInstanceIdInLocation
}: UseResolvedLocationParams) {
    const { t } = useTranslation();
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const ageGatedInstancesVisiblePreference = usePreferencesStore(
        (state) => state.isAgeGatedInstancesVisible
    );
    const globalShowInstanceIdInLocation = usePreferencesStore(
        (state) => state.showInstanceIdInLocation
    );
    const currentLocation = resolveLocationTarget(location, traveling);
    const hasShortNameHint = Boolean(
        !normalizeString(currentLocation) && normalizeString(hint).length === 8
    );
    const isTraveling =
        typeof traveling !== 'undefined' &&
        normalizeString(location) === 'traveling';
    const resolvedGroupHint = normalizeString(groupHint || grouphint);
    const parsedLocation = useMemo(
        () => parseLocation(currentLocation),
        [currentLocation]
    );
    const {
        currentEndpoint,
        region,
        instanceName,
        isClosed,
        groupName,
        worldName,
        worldNameHint
    } = useLocationMetadata({
        locationInfo: parsedLocation,
        currentLocation,
        endpoint,
        hint,
        groupHint: resolvedGroupHint
    });
    const ageGatedInstancesVisible =
        preferencesHydrated && ageGatedInstancesVisiblePreference;
    const isAgeRestricted = Boolean(
        parsedLocation.ageGate && !ageGatedInstancesVisible
    );
    const isLocationLink = Boolean(
        link &&
        !parsedLocation.isPrivate &&
        !parsedLocation.isOffline &&
        (normalizeString(currentLocation) || hasShortNameHint)
    );
    const accessTypeLabel = translateAccessType(
        parsedLocation.accessTypeName,
        t,
        accessTypeLocaleKeyMap
    );
    const text = getLocationText(parsedLocation, {
        hint: worldNameHint,
        worldName,
        accessTypeLabel,
        t
    });
    const tooltipContent = instanceName
        ? `${t('dialog.new_instance.instance_id')}: #${instanceName}`
        : '';
    const shouldShowInstanceId =
        typeof showInstanceIdInLocation === 'boolean'
            ? showInstanceIdInLocation
            : globalShowInstanceIdInLocation;

    return {
        t,
        currentLocation,
        currentEndpoint,
        parsedLocation,
        region,
        instanceName,
        isClosed,
        groupName,
        worldName,
        worldNameHint,
        isTraveling,
        hasShortNameHint,
        isAgeRestricted,
        isLocationLink,
        text,
        tooltipContent,
        shouldShowInstanceId
    };
}
