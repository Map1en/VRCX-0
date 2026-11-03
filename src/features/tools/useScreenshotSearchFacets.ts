import { useEffect, useState } from 'react';

import { commands, type ScreenshotFacet } from '@/platform/tauri/bindings';

import {
    EMPTY_SCREENSHOT_SEARCH,
    screenshotFilterFromScope
} from './screenshotMetadataValues';

const FACET_LIMIT = 5000;

export function useScreenshotSearchFacets(
    enabled: boolean,
    refreshKey: string | null | undefined
) {
    const [peopleFacets, setPeopleFacets] = useState<ScreenshotFacet[]>([]);
    const [worldFacets, setWorldFacets] = useState<ScreenshotFacet[]>([]);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        let active = true;
        const filter = screenshotFilterFromScope(EMPTY_SCREENSHOT_SEARCH);
        Promise.all([
            commands.appGetScreenshotPeople(filter, FACET_LIMIT),
            commands.appGetScreenshotWorlds(filter, FACET_LIMIT)
        ])
            .then(([people, worlds]) => {
                if (active) {
                    setPeopleFacets(people);
                    setWorldFacets(worlds);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [enabled, refreshKey]);

    return { peopleFacets, worldFacets };
}
