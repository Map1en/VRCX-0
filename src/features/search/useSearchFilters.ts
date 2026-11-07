import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
    readSearchPageSizes,
    writeSearchPageSizes,
    type SearchPageSizes
} from './searchPageSizes';
import { useSearchPageField } from './searchPageStore';
import type { SearchActiveTab, SearchPageTab } from './searchTypes';

function isSearchPageTab(value: string | null): value is SearchPageTab {
    return (
        value === 'avatar' ||
        value === 'group' ||
        value === 'hot' ||
        value === 'user' ||
        value === 'world'
    );
}

export function useSearchFilters() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [rememberedTab, setRememberedTab] = useSearchPageField('activeTab');
    const requestedTab = searchParams.get('tab');
    let activeTab: SearchPageTab = rememberedTab;
    if (requestedTab !== null) {
        activeTab = isSearchPageTab(requestedTab) ? requestedTab : 'hot';
    }
    const [searchText, setSearchText] = useSearchPageField('searchText');
    const [searchUserSortByLastLoggedIn, setSearchUserSortByLastLoggedIn] =
        useSearchPageField('searchUserSortByLastLoggedIn');
    const [selectedWorldCategory, setSelectedWorldCategory] =
        useSearchPageField('selectedWorldCategory');
    const [includeCommunityLabs, setIncludeCommunityLabs] = useSearchPageField(
        'includeCommunityLabs'
    );
    const [pageSizes, setPageSizes] =
        useState<SearchPageSizes>(readSearchPageSizes);
    const setPageSize = (tab: SearchActiveTab, pageSize: number) => {
        const nextPageSizes = { ...pageSizes, [tab]: pageSize };
        setPageSizes(nextPageSizes);
        writeSearchPageSizes(nextPageSizes);
    };
    useEffect(() => {
        setRememberedTab(activeTab);
    }, [activeTab, setRememberedTab]);
    const setActiveTab = (value: string) => {
        if (!isSearchPageTab(value)) {
            return;
        }

        setRememberedTab(value);
        const nextSearchParams = new URLSearchParams(searchParams);
        if (value === 'hot') {
            nextSearchParams.delete('tab');
        } else {
            nextSearchParams.set('tab', value);
        }
        setSearchParams(nextSearchParams, { replace: true });
    };

    return {
        activeTab,
        includeCommunityLabs,
        pageSizes,
        searchText,
        searchUserSortByLastLoggedIn,
        selectedWorldCategory,
        setActiveTab,
        setIncludeCommunityLabs,
        setPageSize,
        setSearchText,
        setSearchUserSortByLastLoggedIn,
        setSelectedWorldCategory
    };
}
