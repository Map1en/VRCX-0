import { instanceRepository } from '@/repositories/index.js';
import { parseLocation } from '@/shared/utils/locationParser.js';

import { buildCreatedInstanceDetails } from './worldInstances.js';

export async function resolveCreatedInstanceDetails(
    location,
    instance,
    endpoint,
    fallback = {}
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
        const response = await instanceRepository.getInstanceShortName({
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
