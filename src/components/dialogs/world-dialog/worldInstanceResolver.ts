import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { parseLocation } from '@/shared/utils/location';

import { buildCreatedInstanceDetails } from './worldInstances';

export async function resolveCreatedInstanceDetails(
    location: any,
    instance: any,
    endpoint: any,
    fallback: any = {}
) {
    const parsedLocation = parseLocation(location);
    if (
        !parsedLocation.worldId ||
        !parsedLocation.instanceId ||
        instance?.shortName
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
                ...instance,
                shortName: response.json?.shortName,
                secureName: response.json?.secureName
            },
            fallback
        );
    } catch {
        return buildCreatedInstanceDetails(location, instance, fallback);
    }
}
