import { useDeferredValue, useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';

import {
    MY_AVATARS_DEFAULT_CARD_SCALE,
    MY_AVATARS_GRID_DENSITY_CONFIG_KEY,
    MY_AVATARS_LEGACY_GRID_DENSITY_CONFIG_KEY,
    resolveMyAvatarsGridDensity,
    sanitizeMyAvatarsGridDensity
} from './myAvatarsState';
import type { MyAvatarsGridDensity, MyAvatarsViewMode } from './myAvatarsTypes';

export function useMyAvatarsFilters() {
    const [viewMode, setViewMode] = useState<MyAvatarsViewMode>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [releaseStatusFilter, setReleaseStatusFilter] = useState('all');
    const [platformFilter, setPlatformFilter] = useState('all');
    const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set());
    const [gridDensity, setGridDensity] = useState<MyAvatarsGridDensity>(
        () => resolveMyAvatarsGridDensity() as MyAvatarsGridDensity
    );

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('MyAvatarsViewMode', 'grid'),
            configRepository.getString(MY_AVATARS_GRID_DENSITY_CONFIG_KEY, ''),
            configRepository.getString(
                MY_AVATARS_LEGACY_GRID_DENSITY_CONFIG_KEY,
                ''
            ),
            configRepository.getString(
                'VRCX_MyAvatarsCardScale',
                String(MY_AVATARS_DEFAULT_CARD_SCALE)
            )
        ])
            .then(
                ([
                    nextViewMode,
                    nextGridDensity,
                    nextLegacyGridDensity,
                    nextLegacyCardScale
                ]) => {
                    if (!active) {
                        return;
                    }
                    setViewMode(
                        nextViewMode === 'grid' || nextViewMode === 'table'
                            ? nextViewMode
                            : 'grid'
                    );
                    setGridDensity(
                        resolveMyAvatarsGridDensity({
                            persistedDensity: nextGridDensity,
                            legacyGridDensity: nextLegacyGridDensity,
                            legacyCardScale: nextLegacyCardScale
                        }) as MyAvatarsGridDensity
                    );
                }
            )
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    function handleViewModeChange(nextViewMode: MyAvatarsViewMode) {
        setViewMode(nextViewMode);
        configRepository.setString('MyAvatarsViewMode', nextViewMode);
    }

    function handleGridDensityChange(value: string) {
        const nextDensity = sanitizeMyAvatarsGridDensity(
            value
        ) as MyAvatarsGridDensity;
        setGridDensity(nextDensity);
        configRepository.setString(
            MY_AVATARS_GRID_DENSITY_CONFIG_KEY,
            nextDensity
        );
    }

    function clearFilters() {
        setReleaseStatusFilter('all');
        setPlatformFilter('all');
        setTagFilters(new Set());
    }

    return {
        clearFilters,
        deferredSearchQuery,
        gridDensity,
        handleGridDensityChange,
        handleViewModeChange,
        platformFilter,
        releaseStatusFilter,
        searchQuery,
        setPlatformFilter,
        setReleaseStatusFilter,
        setSearchQuery,
        setTagFilters,
        tagFilters,
        viewMode
    };
}
