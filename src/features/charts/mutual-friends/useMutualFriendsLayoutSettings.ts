import { useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';

import {
    clampMutualGraphNumber,
    MUTUAL_GRAPH_LAYOUT_DEFAULTS,
    MUTUAL_GRAPH_LAYOUT_LIMITS
} from './mutualFriendsSettings';

const {
    layoutIterations: LAYOUT_ITERATIONS_LIMITS,
    layoutSpacing: LAYOUT_SPACING_LIMITS,
    edgeCurvature: EDGE_CURVATURE_LIMITS,
    communitySeparation: COMMUNITY_SEPARATION_LIMITS
} = MUTUAL_GRAPH_LAYOUT_LIMITS;

const layoutSettingConfig: any = {
    layoutIterations: {
        configKey: 'MutualGraphLayoutIterations',
        persist: (value: any) =>
            configRepository.setInt('MutualGraphLayoutIterations', value),
        limits: LAYOUT_ITERATIONS_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.layoutIterations
    },
    layoutSpacing: {
        configKey: 'MutualGraphLayoutSpacing',
        persist: (value: any) =>
            configRepository.setInt('MutualGraphLayoutSpacing', value),
        limits: LAYOUT_SPACING_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.layoutSpacing
    },
    edgeCurvature: {
        configKey: 'MutualGraphEdgeCurvature',
        persist: (value: any) =>
            configRepository.setFloat('MutualGraphEdgeCurvature', value),
        limits: EDGE_CURVATURE_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.edgeCurvature,
        decimals: 2
    },
    communitySeparation: {
        configKey: 'MutualGraphCommunitySeparation',
        persist: (value: any) =>
            configRepository.setFloat('MutualGraphCommunitySeparation', value),
        limits: COMMUNITY_SEPARATION_LIMITS,
        defaultValue: MUTUAL_GRAPH_LAYOUT_DEFAULTS.communitySeparation,
        decimals: 1
    }
};

function normalizeLayoutSetting(key: any, value: any) {
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
            .then(([iterations, spacing, curvature, separation]: any) => {
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

    function setLayoutSetting(key: any, value: any) {
        const nextValue = normalizeLayoutSetting(key, value);
        setLayoutSettings((current: any) => ({
            ...current,
            [key]: nextValue
        }));
        const config = layoutSettingConfig[key];
        if (config) {
            config.persist(nextValue);
        }
    }

    function resetLayoutSettings() {
        setLayoutSettings(MUTUAL_GRAPH_LAYOUT_DEFAULTS);
        for (const [key, config] of Object.entries(layoutSettingConfig)) {
            const persist =
                config && typeof config === 'object' && 'persist' in config
                    ? config.persist
                    : null;
            if (typeof persist === 'function') {
                persist(MUTUAL_GRAPH_LAYOUT_DEFAULTS[key]);
            }
        }
    }

    return {
        layoutSettings,
        resetLayoutSettings,
        setLayoutSetting
    };
}
