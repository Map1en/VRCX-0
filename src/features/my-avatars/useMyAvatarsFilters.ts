import { useDeferredValue, useEffect, useState } from 'react';

import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';
import configRepository from '@/repositories/configRepository';

import {
    MY_AVATARS_DB_GRID_DENSITY_KEYS,
    resolveMyAvatarsGridDensity,
    sanitizeMyAvatarsGridDensity
} from './myAvatarsState';
import type {
    MyAvatarsGridDensity,
    MyAvatarsPlatformFilter,
    MyAvatarsReleaseStatusFilter,
    MyAvatarsSource,
    MyAvatarsViewMode
} from './myAvatarsTypes';

export function useMyAvatarsFilters() {
    const [viewMode, setViewMode] = useState<MyAvatarsViewMode>('grid');
    const [source, setSource] = useState<MyAvatarsSource>('own');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [releaseStatusFilter, setReleaseStatusFilter] =
        useState<MyAvatarsReleaseStatusFilter>('all');
    const [platformFilter, setPlatformFilter] =
        useState<MyAvatarsPlatformFilter>('all');
    const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set());
    const [gridDensity, setGridDensity] = useState<MyAvatarsGridDensity>(() =>
        sanitizeMyAvatarsGridDensity(
            readStoredText(STORAGE_KEYS.myAvatarsGridDensity)
        )
    );

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('MyAvatarsViewMode', 'grid'),
            Promise.all(
                MY_AVATARS_DB_GRID_DENSITY_KEYS.map((key) =>
                    configRepository.getRawValue(key)
                )
            )
        ])
            .then(async ([nextViewMode, storedDensityValues]) => {
                if (!active) {
                    return;
                }
                setViewMode(
                    nextViewMode === 'grid' || nextViewMode === 'table'
                        ? nextViewMode
                        : 'grid'
                );
                if (storedDensityValues.every((value) => value === null)) {
                    return;
                }
                const [persistedDensity, legacyGridDensity, legacyCardScale] =
                    storedDensityValues;
                const nextDensity = resolveMyAvatarsGridDensity({
                    persistedDensity: persistedDensity ?? undefined,
                    legacyGridDensity: legacyGridDensity ?? undefined,
                    legacyCardScale: legacyCardScale ?? undefined
                });
                setGridDensity(nextDensity);
                writeStoredText(STORAGE_KEYS.myAvatarsGridDensity, nextDensity);
                await Promise.all(
                    MY_AVATARS_DB_GRID_DENSITY_KEYS.filter(
                        (_, index) => storedDensityValues[index] !== null
                    ).map((key) => configRepository.remove(key))
                );
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    function handleViewModeChange(nextViewMode: MyAvatarsViewMode) {
        setViewMode(nextViewMode);
        configRepository.setString('MyAvatarsViewMode', nextViewMode);
    }

    function handleGridDensityChange(value: MyAvatarsGridDensity) {
        const nextDensity = sanitizeMyAvatarsGridDensity(value);
        setGridDensity(nextDensity);
        writeStoredText(STORAGE_KEYS.myAvatarsGridDensity, nextDensity);
    }

    function clearFilters() {
        setReleaseStatusFilter('all');
        setPlatformFilter('all');
        setTagFilters(new Set());
    }

    return {
        source,
        setSource,
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
