import { create } from 'zustand';

import { instanceLocationKey } from '@/domain/presence/instancePresence';

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
    upsertLocationHint: (input: LocationHintInput) => void;
    resetLocationHints: () => void;
}

const initialState: any = {
    version: 0,
    hintsByKey: {}
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

export const useLocationHintStore = create<LocationHintStoreState>(
    (set: any) => ({
        ...initialState,
        upsertLocationHint(input: any) {
            set((state: any) => {
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
                    worldName:
                        text(input.worldName) || existing?.worldName || '',
                    groupName:
                        text(input.groupName) || existing?.groupName || '',
                    instanceName:
                        text(input.instanceName) ||
                        existing?.instanceName ||
                        '',
                    region: text(input.region) || existing?.region || '',
                    isClosed: Boolean(input.isClosed || existing?.isClosed),
                    ageGate: Boolean(input.ageGate || existing?.ageGate),
                    updatedAt: new Date().toISOString()
                };
                if (
                    existing &&
                    JSON.stringify({ ...existing, updatedAt: '' }) ===
                        JSON.stringify({ ...next, updatedAt: '' })
                ) {
                    return state;
                }
                return {
                    version: state.version + 1,
                    hintsByKey: {
                        ...state.hintsByKey,
                        [key]: next
                    }
                };
            });
        },
        resetLocationHints() {
            set(initialState);
        }
    })
);

export { hintKey as locationHintKey };
export type { LocationHint, LocationHintInput, LocationHintStoreState };
