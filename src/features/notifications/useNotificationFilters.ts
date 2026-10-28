import { useDeferredValue, useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';
import { NOTIFICATION_TYPES } from '@/repositories/notificationPersistenceRepository';
import { safeJsonParse } from '@/shared/utils/json';

import { sanitizeNotificationFilters } from './notificationTableState';

const NOTIFICATION_TABLE_FILTERS_CONFIG_KEY = 'VRCX_notificationTableFilters';
const NOTIFICATION_QUICK_FILTER_CONFIG_KEY = 'VRCX_notificationQuickFilter';

export type NotificationQuickFilter = 'all' | 'action' | 'unread';

function sanitizeQuickFilter(value: unknown): NotificationQuickFilter {
    return value === 'action' || value === 'unread' ? value : 'all';
}

export function useNotificationFilters() {
    const [activeTypes, setActiveTypes] = useState<string[]>([]);
    const [quickFilter, setQuickFilter] =
        useState<NotificationQuickFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [filtersReady, setFiltersReady] = useState(false);
    const deferredSearchQuery = useDeferredValue(searchQuery);

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString(
                NOTIFICATION_TABLE_FILTERS_CONFIG_KEY,
                '[]'
            ),
            configRepository.getString(
                NOTIFICATION_QUICK_FILTER_CONFIG_KEY,
                'all'
            )
        ])
            .then(([savedFilters, savedQuickFilter]) => {
                if (!active) {
                    return;
                }
                setActiveTypes(
                    sanitizeNotificationFilters(
                        safeJsonParse(savedFilters),
                        NOTIFICATION_TYPES
                    )
                );
                setQuickFilter(sanitizeQuickFilter(savedQuickFilter));
                setFiltersReady(true);
            })
            .catch(() => {
                if (active) {
                    setFiltersReady(true);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!filtersReady) {
            return;
        }
        configRepository.setString(
            NOTIFICATION_TABLE_FILTERS_CONFIG_KEY,
            JSON.stringify(activeTypes)
        );
    }, [activeTypes, filtersReady]);

    useEffect(() => {
        if (!filtersReady) {
            return;
        }
        configRepository.setString(
            NOTIFICATION_QUICK_FILTER_CONFIG_KEY,
            quickFilter
        );
    }, [filtersReady, quickFilter]);

    function clearFilters() {
        setActiveTypes([]);
        setQuickFilter('all');
        setSearchQuery('');
    }

    return {
        activeTypes,
        clearFilters,
        deferredSearchQuery,
        filtersReady,
        quickFilter,
        searchQuery,
        setActiveTypes,
        setQuickFilter,
        setSearchQuery
    };
}
