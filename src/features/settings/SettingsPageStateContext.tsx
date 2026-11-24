import {
    createContext,
    useContext,
    useLayoutEffect,
    useState,
    type ReactNode
} from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { SettingsPageStateSections } from './settingsPageStateSections';
import { useSettingsPageState } from './useSettingsPageState';

type SettingsPageSection = keyof SettingsPageStateSections;
type SettingsPageStateStore = StoreApi<SettingsPageStateSections>;
type SettingsPageSectionStore = {
    store: SettingsPageStateStore;
    update(nextSections: SettingsPageStateSections): void;
};
type SettingsPageStateRef = {
    current: SettingsPageStateSections;
};

const SettingsPageStateContext = createContext<SettingsPageStateStore | null>(
    null
);

function createSectionSnapshot<Section extends SettingsPageSection>(
    section: Section,
    source: SettingsPageStateSections[Section],
    sourceRef: SettingsPageStateRef,
    previous?: SettingsPageStateSections[Section]
): SettingsPageStateSections[Section] {
    const sourceRecord = source as unknown as Record<string, unknown>;
    const previousRecord = previous as unknown as
        | Record<string, unknown>
        | undefined;
    const entries = Object.entries(sourceRecord);
    const nextRecord: Record<string, unknown> = {};
    let changed =
        !previousRecord ||
        Object.keys(previousRecord).length !== entries.length;

    for (const [key, value] of entries) {
        const previousValue = previousRecord?.[key];
        if (typeof value === 'function') {
            if (typeof previousValue === 'function') {
                nextRecord[key] = previousValue;
                continue;
            }
            changed = true;
            nextRecord[key] = (...args: unknown[]) => {
                const currentSection = sourceRef.current[
                    section
                ] as unknown as Record<string, unknown>;
                const currentAction = currentSection[key];
                if (typeof currentAction !== 'function') {
                    throw new Error(
                        `Settings section action is unavailable: ${section}.${key}`
                    );
                }
                const action = currentAction as (
                    ...actionArgs: unknown[]
                ) => unknown;
                return action(...args);
            };
            continue;
        }
        nextRecord[key] = value;
        if (!Object.is(previousValue, value)) {
            changed = true;
        }
    }

    return previous && !changed
        ? previous
        : (nextRecord as SettingsPageStateSections[Section]);
}

function createSettingsPageStateSnapshot(
    source: SettingsPageStateSections,
    sourceRef: SettingsPageStateRef,
    previous?: SettingsPageStateSections
): SettingsPageStateSections {
    const next = {
        shell: createSectionSnapshot(
            'shell',
            source.shell,
            sourceRef,
            previous?.shell
        ),
        system: createSectionSnapshot(
            'system',
            source.system,
            sourceRef,
            previous?.system
        ),
        interface: createSectionSnapshot(
            'interface',
            source.interface,
            sourceRef,
            previous?.interface
        ),
        media: createSectionSnapshot(
            'media',
            source.media,
            sourceRef,
            previous?.media
        ),
        integrations: createSectionSnapshot(
            'integrations',
            source.integrations,
            sourceRef,
            previous?.integrations
        ),
        social: createSectionSnapshot(
            'social',
            source.social,
            sourceRef,
            previous?.social
        ),
        notifications: createSectionSnapshot(
            'notifications',
            source.notifications,
            sourceRef,
            previous?.notifications
        ),
        vr: createSectionSnapshot('vr', source.vr, sourceRef, previous?.vr),
        advanced: createSectionSnapshot(
            'advanced',
            source.advanced,
            sourceRef,
            previous?.advanced
        ),
        dialogs: createSectionSnapshot(
            'dialogs',
            source.dialogs,
            sourceRef,
            previous?.dialogs
        )
    };
    return previous &&
        next.shell === previous.shell &&
        next.system === previous.system &&
        next.interface === previous.interface &&
        next.media === previous.media &&
        next.integrations === previous.integrations &&
        next.social === previous.social &&
        next.notifications === previous.notifications &&
        next.vr === previous.vr &&
        next.advanced === previous.advanced &&
        next.dialogs === previous.dialogs
        ? previous
        : next;
}

function createSettingsPageSectionStore(
    initialSections: SettingsPageStateSections
): SettingsPageSectionStore {
    const sourceRef: SettingsPageStateRef = { current: initialSections };
    const store = createStore<SettingsPageStateSections>(() =>
        createSettingsPageStateSnapshot(initialSections, sourceRef)
    );
    return {
        store,
        update(nextSections) {
            sourceRef.current = nextSections;
            const current = store.getState();
            const next = createSettingsPageStateSnapshot(
                nextSections,
                sourceRef,
                current
            );
            if (next !== current) {
                store.setState(next, true);
            }
        }
    };
}

export function SettingsPageStateProvider({
    children
}: {
    children: ReactNode;
}) {
    const sections = useSettingsPageState();
    const [sectionStore] = useState(() =>
        createSettingsPageSectionStore(sections)
    );
    useLayoutEffect(() => {
        sectionStore.update(sections);
    }, [sectionStore, sections]);
    return (
        <SettingsPageStateContext.Provider value={sectionStore.store}>
            {children}
        </SettingsPageStateContext.Provider>
    );
}

function useSettingsPageStateStore(): SettingsPageStateStore {
    const store = useContext(SettingsPageStateContext);
    if (!store) {
        throw new Error(
            'useSettingsPageSection must be used inside SettingsPageStateProvider'
        );
    }
    return store;
}

export function useSettingsPageSection<
    Section extends keyof SettingsPageStateSections
>(section: Section): SettingsPageStateSections[Section] {
    const store = useSettingsPageStateStore();
    return useStore(store, (state) => state[section]);
}
