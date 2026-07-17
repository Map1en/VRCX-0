import { create } from 'zustand';

import { instanceLocationKey } from '@/domain/presence/instancePresence';
import { evictOverflow } from '@/state/storeEviction';

interface LocationHint {
    endpoint: string;
    locationKey: string;
    location: string;
    worldId: string;
    groupId: string;
    worldName: string;
    groupName: string;
    instanceName: string;
    region: string;
    isClosed: boolean;
    ageGate: boolean;
    updatedAt: string;
}

interface LocationHintInput {
    endpoint?: unknown;
    location?: unknown;
    worldId?: unknown;
    groupId?: unknown;
    worldName?: unknown;
    groupName?: unknown;
    instanceName?: unknown;
    region?: unknown;
    isClosed?: unknown;
    ageGate?: unknown;
}

interface LocationHintStoreState {
    version: number;
    hintsByKey: Record<string, LocationHint>;
    order: string[];
    upsertLocationHint: (input: LocationHintInput) => void;
    resetLocationHints: () => void;
}

const LOCATION_HINT_CAPACITY = 512;

const initialState: Pick<
    LocationHintStoreState,
    'version' | 'hintsByKey' | 'order'
> = {
    version: 0,
    hintsByKey: {},
    order: []
};

function text(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function hintKey(endpoint: unknown, location: unknown): string {
    const key = instanceLocationKey(location);
    return key ? `${text(endpoint) || 'default'}::${key}` : '';
}

function sameHintIgnoringUpdatedAt(a: LocationHint, b: LocationHint): boolean {
    return (
        a.endpoint === b.endpoint &&
        a.locationKey === b.locationKey &&
        a.location === b.location &&
        a.worldId === b.worldId &&
        a.groupId === b.groupId &&
        a.worldName === b.worldName &&
        a.groupName === b.groupName &&
        a.instanceName === b.instanceName &&
        a.region === b.region &&
        a.isClosed === b.isClosed &&
        a.ageGate === b.ageGate
    );
}

export const useLocationHintStore = create<LocationHintStoreState>((set) => ({
    ...initialState,
    upsertLocationHint(input) {
        set((state) => {
            const key = hintKey(input.endpoint, input.location);
            if (!key) {
                return state;
            }
            const [endpoint, locationKey] = key.split('::');
            const existing = state.hintsByKey[key];
            const next: LocationHint = {
                endpoint,
                locationKey,
                location: text(input.location) || existing?.location || '',
                worldId: text(input.worldId) || existing?.worldId || '',
                groupId: text(input.groupId) || existing?.groupId || '',
                worldName: text(input.worldName) || existing?.worldName || '',
                groupName: text(input.groupName) || existing?.groupName || '',
                instanceName:
                    text(input.instanceName) || existing?.instanceName || '',
                region: text(input.region) || existing?.region || '',
                isClosed: Boolean(input.isClosed || existing?.isClosed),
                ageGate: Boolean(input.ageGate || existing?.ageGate),
                updatedAt: new Date().toISOString()
            };
            if (existing && sameHintIgnoringUpdatedAt(existing, next)) {
                return state;
            }
            const hintsByKey = { ...state.hintsByKey, [key]: next };
            const order = existing ? state.order : [...state.order, key];
            for (const evictedKey of evictOverflow(
                order,
                LOCATION_HINT_CAPACITY
            )) {
                delete hintsByKey[evictedKey];
            }
            return {
                version: state.version + 1,
                hintsByKey,
                order
            };
        });
    },
    resetLocationHints() {
        set(initialState);
    }
}));

export { hintKey as locationHintKey };
export type { LocationHint, LocationHintInput, LocationHintStoreState };
