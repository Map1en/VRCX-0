import { useCallback, useEffect, useRef, useState } from 'react';

import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';
import configRepository from '@/repositories/configRepository';
import { safeJsonParse } from '@/shared/utils/json';

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

export function useFeedViewModeState() {
    const [ready, setReady] = useState(false);
    const [viewMode, setViewModeState] = useState<FeedViewMode>('table');
    const [density, setDensityState] = useState<FeedColumnDensity>(() =>
        sanitizeFeedColumnDensity(
            readStoredText(STORAGE_KEYS.feedColumnsDensity) ??
                DEFAULT_FEED_COLUMN_DENSITY
        )
    );
    const [columns, setColumns] = useState<FeedColumnConfig[]>(() =>
        FEED_COLUMNS_DEFAULT_CONFIG.map((column) => ({ ...column }))
    );
    const hasWrittenModeRef = useRef(false);
    const hasWrittenColumnsRef = useRef(false);

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('feedViewMode', 'table'),
            configRepository.getString('feedColumnsConfig', '[]')
        ])
            .then(([savedMode, savedColumns]) => {
                if (!active) {
                    return;
                }
                setViewModeState(sanitizeFeedViewMode(savedMode));
                setColumns(
                    sanitizeFeedColumnsConfig(safeJsonParse(savedColumns))
                );
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
        if (!hasWrittenColumnsRef.current) {
            hasWrittenColumnsRef.current = true;
            return;
        }
        configRepository.setString(
            'feedColumnsConfig',
            JSON.stringify(columns)
        );
    }, [columns, ready]);

    const setDensity = useCallback((value: FeedColumnDensity) => {
        setDensityState(value);
        writeStoredText(STORAGE_KEYS.feedColumnsDensity, value);
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
