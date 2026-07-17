import { create } from 'zustand';

import {
    buildInstancePresenceFact,
    instancePresenceKey,
    sameInstancePresenceFact,
    type InstancePresenceFact,
    type InstancePresenceFactInput
} from '@/domain/presence/instancePresence';
import { evictOverflow } from '@/state/storeEviction';

interface InstancePresenceStoreState {
    version: number;
    presenceByKey: Record<string, InstancePresenceFact>;
    order: string[];
    upsertInstancePresence: (input: InstancePresenceFactInput) => void;
    resetInstancePresence: () => void;
}

const INSTANCE_PRESENCE_CAPACITY = 256;

const initialState: Pick<
    InstancePresenceStoreState,
    'version' | 'presenceByKey' | 'order'
> = {
    version: 0,
    presenceByKey: {},
    order: []
};

export const useInstancePresenceStore = create<InstancePresenceStoreState>(
    (set) => ({
        ...initialState,
        upsertInstancePresence(input) {
            set((state) => {
                const key = instancePresenceKey(input.endpoint, input.location);
                const fact = buildInstancePresenceFact(input);
                if (!key || !fact) {
                    return state;
                }
                const existing = state.presenceByKey[key];
                if (existing && sameInstancePresenceFact(existing, fact)) {
                    return state;
                }
                const presenceByKey = { ...state.presenceByKey, [key]: fact };
                const order = existing ? state.order : [...state.order, key];
                for (const evictedKey of evictOverflow(
                    order,
                    INSTANCE_PRESENCE_CAPACITY
                )) {
                    delete presenceByKey[evictedKey];
                }
                return {
                    version: state.version + 1,
                    presenceByKey,
                    order
                };
            });
        },
        resetInstancePresence() {
            set(initialState);
        }
    })
);

export type { InstancePresenceStoreState };
