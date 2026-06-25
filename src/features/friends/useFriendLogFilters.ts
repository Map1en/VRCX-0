import { useEffect, useRef, useState } from 'react';

import configRepository from '@/repositories/configRepository';

import { parseTypeFilters } from './friendLogState';

export function useFriendLogFilters() {
    const hydratedTypeFiltersRef = useRef(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

    useEffect(() => {
        let active = true;
        configRepository
            .getString('friendLogTableFilters', '[]')
            .then((nextTypeFilters: any) => {
                if (!active) {
                    return;
                }
                setSelectedTypes(parseTypeFilters(nextTypeFilters));
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

    return {
        refreshToken,
        searchQuery,
        selectedTypes,
        refreshFriendLog,
        setSearchQuery,
        setSelectedTypes
    };
}
