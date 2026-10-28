import { useCallback, useEffect, useRef, useState } from 'react';

import configRepository from '@/repositories/configRepository';

import { parseTypeFilters } from './friendLogState';

export function useFriendLogFilters() {
    const hydratedTypeFiltersRef = useRef(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [targetUser, setTargetUser] = useState<{
        id: string;
        name: string;
    } | null>(null);

    useEffect(() => {
        let active = true;
        configRepository
            .getString('friendLogTableFilters', '[]')
            .then((nextTypeFilters) => {
                if (!active) {
                    return;
                }
                const parsed = parseTypeFilters(nextTypeFilters);
                setSelectedTypes((current) =>
                    current.length === parsed.length &&
                    current.every((type, index) => type === parsed[index])
                        ? current
                        : parsed
                );
                hydratedTypeFiltersRef.current = true;
            })
            .catch(() => {
                hydratedTypeFiltersRef.current = true;
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!hydratedTypeFiltersRef.current) {
            return;
        }
        configRepository.setString(
            'friendLogTableFilters',
            JSON.stringify(selectedTypes)
        );
    }, [selectedTypes]);

    function refreshFriendLog() {
        setRefreshToken((value) => value + 1);
    }

    const setDateRange = useCallback((from: string, to: string) => {
        setDateFrom(from);
        setDateTo(to);
    }, []);

    function commitSearch() {
        setSearchQuery(searchDraft);
    }

    function clearSearch() {
        setSearchDraft('');
        setSearchQuery('');
    }

    return {
        refreshToken,
        searchQuery,
        searchDraft,
        setSearchDraft,
        commitSearch,
        clearSearch,
        dateFrom,
        dateTo,
        setDateRange,
        selectedTypes,
        refreshFriendLog,
        setSearchQuery,
        setSelectedTypes,
        targetUser,
        setTargetUser
    };
}
