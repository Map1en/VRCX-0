import { useCallback, useEffect, useRef, useState } from 'react';

import configRepository from '@/repositories/configRepository';

import {
    DEFAULT_FEED_COLUMN_DENSITY,
    type FeedColumnDensity,
    sanitizeFeedColumnDensity
} from './feedColumnsDensity';
import {
    FEED_COLUMNS_DEFAULT_CONFIG,
    type FeedColumnConfig,
    type FeedViewMode,
    sanitizeFeedColumnsConfig,
    sanitizeFeedViewMode
} from './feedColumnsState';
import { safeJsonParse } from './feedTableState';

export function useFeedViewModeState() {
    const [ready, setReady] = useState(false);
    const [viewMode, setViewModeState] = useState<FeedViewMode>('table');
    const [density, setDensityState] = useState<FeedColumnDensity>(
        DEFAULT_FEED_COLUMN_DENSITY
    );
    const [columns, setColumns] = useState<FeedColumnConfig[]>(() =>
        FEED_COLUMNS_DEFAULT_CONFIG.map((column) => ({ ...column }))
    );
    const hasWrittenModeRef = useRef(false);
    const hasWrittenDensityRef = useRef(false);
    const hasWrittenColumnsRef = useRef(false);

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('feedViewMode', 'table'),
            configRepository.getString('feedColumnsConfig', '[]'),
            configRepository.getString(
                'feedColumnsDensity',
                DEFAULT_FEED_COLUMN_DENSITY
            )
        ])
            .then(([savedMode, savedColumns, savedDensity]) => {
                if (!active) {
                    return;
                }
                setViewModeState(sanitizeFeedViewMode(savedMode));
                setColumns(
                    sanitizeFeedColumnsConfig(safeJsonParse(savedColumns))
                );
                setDensityState(sanitizeFeedColumnDensity(savedDensity));
                setReady(true);
            })
            .catch(() => {
                if (active) {
                    setReady(true);
                }
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!ready) {
            return;
        }
        if (!hasWrittenModeRef.current) {
            hasWrittenModeRef.current = true;
            return;
        }
        configRepository.setString('feedViewMode', viewMode);
    }, [ready, viewMode]);

    useEffect(() => {
        if (!ready) {
            return;
        }
        if (!hasWrittenDensityRef.current) {
            hasWrittenDensityRef.current = true;
            return;
        }
        configRepository.setString('feedColumnsDensity', density);
    }, [density, ready]);

    useEffect(() => {
        if (!ready) {
            return;
        }
        if (!hasWrittenColumnsRef.current) {
            hasWrittenColumnsRef.current = true;
            return;
        }
        configRepository.setString(
            'feedColumnsConfig',
            JSON.stringify(columns)
        );
    }, [columns, ready]);

    const setDensity = useCallback((value: unknown) => {
        setDensityState(sanitizeFeedColumnDensity(value));
    }, []);

    const setViewMode = useCallback((value: FeedViewMode) => {
        setViewModeState(value);
    }, []);

    return {
        columns,
        density,
        ready,
        setColumns,
        setDensity,
        setViewMode,
        viewMode
    };
}
