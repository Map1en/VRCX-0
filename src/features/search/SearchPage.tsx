import { PageScaffold } from '@/components/layout/PageScaffold';
import { AvatarProviderSettingsDialog } from '@/components/search/AvatarProviderSettingsDialog';
import { Tabs } from '@/ui/shadcn/tabs';

import { SearchPageToolbar } from './components/SearchPageToolbar';
import {
    SearchAvatarTabPanel,
    SearchGroupTabPanel,
    SearchUserTabPanel,
    SearchWorldTabPanel
} from './components/SearchTabPanels';
import { useSearchPageController } from './useSearchPageController';

export function SearchPage() {
    const { config, filters, results } = useSearchPageController();

    return (
        <PageScaffold className="flex-1">
            <Tabs
                value={filters.activeTab}
                onValueChange={filters.setActiveTab}
                className="flex min-h-0 flex-1 flex-col"
            >
                <SearchPageToolbar
                    activeTab={filters.activeTab}
                    searchText={filters.searchText}
                    onSearchTextChange={filters.setSearchText}
                    onSearch={results.handleSearch}
                    onClearSearch={results.handleClearSearch}
                />
                <SearchUserTabPanel
                    searchUserByBio={filters.searchUserByBio}
                    onSearchUserByBioChange={filters.setSearchUserByBio}
                    searchUserSortByLastLoggedIn={
                        filters.searchUserSortByLastLoggedIn
                    }
                    onSearchUserSortByLastLoggedInChange={
                        filters.setSearchUserSortByLastLoggedIn
                    }
                    isLoading={results.isUserLoading}
                    results={results.userResults}
                    languageOptionsMap={config.languageOptionsMap}
                    pagination={results.pagination}
                />
                <SearchWorldTabPanel
                    includeCommunityLabs={filters.includeCommunityLabs}
                    onIncludeCommunityLabsChange={
                        filters.setIncludeCommunityLabs
                    }
                    selectedWorldCategory={filters.selectedWorldCategory}
                    onWorldCategoryChange={results.handleWorldCategoryChange}
                    worldCategories={config.worldCategories}
                    isLoading={results.isWorldLoading}
                    results={results.worldResults}
                    pagination={results.pagination}
                />
                <SearchAvatarTabPanel
                    avatarProviderList={config.avatarProviderList}
                    selectedAvatarProvider={config.selectedAvatarProvider}
                    onAvatarProviderChange={config.handleAvatarProviderChange}
                    onOpenAvatarProviderSettings={() =>
                        config.setIsAvatarProviderDialogOpen(true)
                    }
                    isLoading={results.isAvatarLoading}
                    results={results.avatarPageResults}
                    pagination={results.pagination}
                />
                <SearchGroupTabPanel
                    isLoading={results.isGroupLoading}
                    results={results.groupResults}
                    pagination={results.pagination}
                />
            </Tabs>
            <AvatarProviderSettingsDialog
                open={config.isAvatarProviderDialogOpen}
                onOpenChange={config.setIsAvatarProviderDialogOpen}
                providerList={config.avatarProviderList}
                onConfigSaved={config.applyAvatarProviderConfig}
            />
        </PageScaffold>
    );
}
