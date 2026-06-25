import { useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';
import {
    normalizeFeedTimeDisplayMode,
    type FeedTimeDisplayModePreference,
    usePreferencesStore
} from '@/state/preferencesStore';

export function useFeedTimeDisplayMode() {
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const preferenceMode = usePreferencesStore(
        (state: any) => state.feedTimeDisplayMode
    );
    const [mode, setMode] = useState<FeedTimeDisplayModePreference>('relative');

    useEffect(() => {
        if (preferencesHydrated) {
            setMode(normalizeFeedTimeDisplayMode(preferenceMode));
            return undefined;
        }

        let active = true;
        configRepository
            .getString('feedTimeDisplayMode', 'relative')
            .then((value) => {
                if (active) {
                    setMode(normalizeFeedTimeDisplayMode(value));
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [preferenceMode, preferencesHydrated]);

    useEffect(() => {
        return onPreferenceChanged('feedTimeDisplayMode', (value) => {
            setMode(normalizeFeedTimeDisplayMode(value));
        });
    }, []);

    return mode;
}
