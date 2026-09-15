import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

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
        searchText,
        searchUserByBio,
        searchUserSortByLastLoggedIn,
        selectedWorldCategory,
        setActiveTab,
        setIncludeCommunityLabs,
        setSearchText,
        setSearchUserByBio,
        setSearchUserSortByLastLoggedIn,
        setSelectedWorldCategory
    };
}
