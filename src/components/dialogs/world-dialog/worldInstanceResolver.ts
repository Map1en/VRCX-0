import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { parseLocation } from '@/shared/utils/location';

import {
    buildCreatedInstanceDetails,
    type CreatedInstanceFallback
} from './worldInstances';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export async function resolveCreatedInstanceDetails(
    location: unknown,
    instance: unknown,
    endpoint: string,
    fallback: CreatedInstanceFallback = {}
) {
    const parsedLocation = parseLocation(location);
    const source = isRecord(instance) ? instance : {};
    if (
        !parsedLocation.worldId ||
        !parsedLocation.instanceId ||
        source.shortName
    ) {
        return buildCreatedInstanceDetails(location, instance, fallback);
    }
    try {
        const response = await vrchatInstanceRepository.getInstanceShortName({
            worldId: parsedLocation.worldId,
            instanceId: parsedLocation.instanceId,
            endpoint
        });
        return buildCreatedInstanceDetails(
            location,
            {
                ...source,
                shortName: response.json?.shortName,
                secureName: response.json?.secureName
            },
            fallback
        );
    } catch {
        return buildCreatedInstanceDetails(location, instance, fallback);
    }
}
