import { useEffect, useState } from 'react';

import { configRepository } from '@/repositories/index.js';

import {
    clampMutualGraphNumber,
    MUTUAL_GRAPH_LAYOUT_DEFAULTS,
    MUTUAL_GRAPH_LAYOUT_LIMITS
} from './mutualFriendsSettings.js';

const {
    layoutIterations: LAYOUT_ITERATIONS_LIMITS,
    layoutSpacing: LAYOUT_SPACING_LIMITS,
    edgeCurvature: EDGE_CURVATURE_LIMITS,
    communitySeparation: COMMUNITY_SEPARATION_LIMITS
} = MUTUAL_GRAPH_LAYOUT_LIMITS;

const layoutSettingConfig = {
    layoutIterations: {
        configKey: 'MutualGraphLayoutIterations',
        persist: (value) =>
            configRepository.setInt('MutualGraphLayoutIterations', value),
        limits: LAYOUT_ITERATIONS_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.layoutIterations
    },
    layoutSpacing: {
        configKey: 'MutualGraphLayoutSpacing',
        persist: (value) =>
            configRepository.setInt('MutualGraphLayoutSpacing', value),
        limits: LAYOUT_SPACING_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.layoutSpacing
    },
    edgeCurvature: {
        configKey: 'MutualGraphEdgeCurvature',
        persist: (value) =>
            configRepository.setFloat('MutualGraphEdgeCurvature', value),
        limits: EDGE_CURVATURE_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.edgeCurvature,
        decimals: 2
    },
    communitySeparation: {
        configKey: 'MutualGraphCommunitySeparation',
        persist: (value) =>
            configRepository.setFloat('MutualGraphCommunitySeparation', value),
        limits: COMMUNITY_SEPARATION_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.communitySeparation,
        decimals: 1
    }
};

function normalizeLayoutSetting(key, value) {
    const config = layoutSettingConfig[key];
    if (!config) {
        return value;
    }
    const nextValue = clampMutualGraphNumber(
        value,
        config.limits.min,
        config.limits.max,
        config.defaultValue
    );
    return Number.isInteger(config.decimals)
        ? Number(nextValue.toFixed(config.decimals))
        : nextValue;
}

export function useMutualFriendsLayoutSettings() {
    const [layoutSettings, setLayoutSettings] = useState(
        MUTUAL_GRAPH_LAYOUT_DEFAULTS
    );

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getInt(
                'MutualGraphLayoutIterations',
                MUTUAL_GRAPH_LAYOUT_DEFAULTS.layoutIterations
            ),
            configRepository.getInt(
                'MutualGraphLayoutSpacing',
                MUTUAL_GRAPH_LAYOUT_DEFAULTS.layoutSpacing
            ),
            configRepository.getFloat(
                'MutualGraphEdgeCurvature',
                MUTUAL_GRAPH_LAYOUT_DEFAULTS.edgeCurvature
            ),
            configRepository.getFloat(
                'MutualGraphCommunitySeparation',
                MUTUAL_GRAPH_LAYOUT_DEFAULTS.communitySeparation
            )
        ])
            .then(([iterations, spacing, curvature, separation]) => {
                if (!active) {
                    return;
                }

                setLayoutSettings({
                    layoutIterations: normalizeLayoutSetting(
                        'layoutIterations',
                        iterations
                    ),
                    layoutSpacing: normalizeLayoutSetting(
                        'layoutSpacing',
                        spacing
                    ),
                    edgeCurvature: normalizeLayoutSetting(
                        'edgeCurvature',
                        curvature
                    ),
                    communitySeparation: normalizeLayoutSetting(
                        'communitySeparation',
                        separation
                    )
                });
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    function setLayoutSetting(key, value) {
        const nextValue = normalizeLayoutSetting(key, value);
        setLayoutSettings((current) => ({
            ...current,
            [key]: nextValue
        }));
        const config = layoutSettingConfig[key];
        if (config) {
            void config.persist(nextValue);
        }
    }

    function resetLayoutSettings() {
        setLayoutSettings(MUTUAL_GRAPH_LAYOUT_DEFAULTS);
        for (const [key, config] of Object.entries(layoutSettingConfig)) {
            void config.persist(MUTUAL_GRAPH_LAYOUT_DEFAULTS[key]);
        }
    }

    return {
        layoutSettings,
        resetLayoutSettings,
        setLayoutSetting
    };
}
