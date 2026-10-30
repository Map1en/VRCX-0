import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
    readSearchPageSizes,
    writeSearchPageSizes,
    type SearchPageSizes
} from './searchPageSizes';
import { useSearchPageField } from './searchPageStore';
import type { SearchActiveTab } from './searchTypes';

export function useSearchFilters() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [rememberedTab, setRememberedTab] = useSearchPageField('activeTab');
    const requestedTab = searchParams.get('tab');
    let activeTab: SearchActiveTab = rememberedTab;
    if (requestedTab !== null) {
        activeTab =
            requestedTab === 'avatar' ||
            requestedTab === 'group' ||
            requestedTab === 'world'
                ? requestedTab
                : 'user';
    }
    const [searchText, setSearchText] = useSearchPageField('searchText');
    const [searchUserByBio, setSearchUserByBio] =
        useSearchPageField('searchUserByBio');
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
        if (
            value !== 'avatar' &&
            value !== 'group' &&
            value !== 'user' &&
            value !== 'world'
        ) {
            return;
        }

        setRememberedTab(value);
        const nextSearchParams = new URLSearchParams(searchParams);
        if (value === 'user') {
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
        searchUserByBio,
        searchUserSortByLastLoggedIn,
        selectedWorldCategory,
        setActiveTab,
        setIncludeCommunityLabs,
        setPageSize,
        setSearchText,
        setSearchUserByBio,
        setSearchUserSortByLastLoggedIn,
        setSelectedWorldCategory
    };
}
