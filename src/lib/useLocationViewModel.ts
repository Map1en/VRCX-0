import { useMemo } from 'react';

import { createLocationViewModel } from '@/domain/locations/locationViewModel';
import { instancePresenceKey } from '@/domain/presence/instancePresence';
import { useLocationHintStore } from '@/state/locationHintStore';
import { useRuntimeStore } from '@/state/runtimeStore';

interface UseLocationViewModelOptions {
    endpoint?: unknown;
    location?: unknown;
    traveling?: unknown;
    hint?: unknown;
}

function useLocationViewModel({
    endpoint = '',
    location = '',
    traveling,
    hint = ''
}: UseLocationViewModelOptions = {}) {
    const storeEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const resolvedEndpoint = endpoint || storeEndpoint;
    const key = useMemo(
        () => instancePresenceKey(resolvedEndpoint, location),
        [location, resolvedEndpoint]
    );
    const locationHint = useLocationHintStore((state) =>
        key ? state.hintsByKey[key] || null : null
    );

    return useMemo(
        () =>
            createLocationViewModel({
                location,
                traveling,
                hint,
                metadata: locationHint
            }),
        [hint, location, locationHint, traveling]
    );
}

export { useLocationViewModel };
