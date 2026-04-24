import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { AvatarProviderSettingsDialog } from '@/components/search/AvatarProviderSettingsDialog.jsx';
import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import {
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
    avatarSearchProviderRepository,
    userProfileRepository,
    vrchatSearchRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { Tabs } from '@/ui/shadcn/tabs';

import { SearchPageToolbar } from './components/SearchPageToolbar.jsx';
import {
    SearchAvatarTabPanel,
    SearchGroupTabPanel,
    SearchUserTabPanel,
    SearchWorldTabPanel
} from './components/SearchTabPanels.jsx';
import {
    buildAvatarSearchRequest,
    buildGroupSearchRequest,
    buildUserSearchRequest,
    buildWorldSearchRequest,
    SEARCH_PAGE_SIZE as PAGE_SIZE
} from './searchRequests.js';
import { dedupeById, emptyArray } from './searchResults.js';
import { useSearchPagination } from './useSearchPagination.js';

export function SearchPage() {
    const { t } = useTranslation();
    const searchSequenceRef = useRef({
        user: 0,
        world: 0,
        group: 0,
        avatar: 0
    });
    const [activeTab, setActiveTab] = useState('user');
    const [searchText, setSearchText] = useState('');
    const [searchUserByBio, setSearchUserByBio] = useState(false);
    const [searchUserSortByLastLoggedIn, setSearchUserSortByLastLoggedIn] =
        useState(false);
    const [worldCategories, setWorldCategories] = useState([]);
    const [selectedWorldCategory, setSelectedWorldCategory] = useState('');
    const [includeCommunityLabs, setIncludeCommunityLabs] = useState(false);
    const [userRequest, setUserRequest] = useState(null);
    const [worldRequest, setWorldRequest] = useState(null);
    const [groupRequest, setGroupRequest] = useState(null);
    const [avatarRequest, setAvatarRequest] = useState(null);
    const [userResults, setUserResults] = useState([]);
    const [worldResults, setWorldResults] = useState([]);
    const [groupResults, setGroupResults] = useState([]);
    const [avatarResults, setAvatarResults] = useState([]);
    const [isUserLoading, setIsUserLoading] = useState(false);
    const [isWorldLoading, setIsWorldLoading] = useState(false);
    const [isGroupLoading, setIsGroupLoading] = useState(false);
    const [isAvatarLoading, setIsAvatarLoading] = useState(false);
    const [avatarProviderEnabled, setAvatarProviderEnabled] = useState(false);
    const [avatarProviderList, setAvatarProviderList] = useState([]);
    const [selectedAvatarProvider, setSelectedAvatarProvider] = useState('');
    const [isAvatarProviderDialogOpen, setIsAvatarProviderDialogOpen] =
        useState(false);
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    function applyAvatarProviderConfig(config) {
        setAvatarProviderEnabled(config.enabled);
        setAvatarProviderList(config.providerList);
        setSelectedAvatarProvider(config.selectedProvider || '');
    }

    useEffect(() => {
        let active = true;

        vrchatSearchRepository
            .getConfig()
            .then(({ json }) => {
                if (!active) {
                    return;
                }

                setWorldCategories(
                    emptyArray(json?.dynamicWorldRows).filter(
                        (row) => row?.index != null
                    )
                );
            })
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.search.generated_toast.failed_to_load_world_categories'
                          )
                );
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const unsubscribe = onPreferenceChanged(
            AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
            () => {
                avatarSearchProviderRepository
                    .getConfig()
                    .then((config) => {
                        if (active) {
                            applyAvatarProviderConfig(config);
                        }
                    })
                    .catch((error) => {
                        console.warn(
                            'Failed to refresh avatar providers:',
                            error
                        );
                    });
            }
        );

        avatarSearchProviderRepository
            .getConfig()
            .then((config) => {
                if (!active) {
                    return;
                }

                applyAvatarProviderConfig(config);
            })
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.search.generated_toast.failed_to_load_avatar_providers'
                          )
                );
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        function handleKeyDown(event) {
            if (!event.altKey) {
                return;
            }

            if (event.key === 'ArrowLeft' && !pagination.prevDisabled) {
                event.preventDefault();
                pagination.onPrev();
            }

            if (event.key === 'ArrowRight' && !pagination.nextDisabled) {
                event.preventDefault();
                pagination.onNext();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [
        activeTab,
        groupRequest,
        groupResults.length,
        avatarRequest,
        avatarResults.length,
        isAvatarLoading,
        isGroupLoading,
        isUserLoading,
        isWorldLoading,
        userRequest,
        userResults.length,
        worldRequest,
        worldResults.length
    ]);

    const searchPlaceholder =
        activeTab === 'avatar'
            ? t('view.search.avatar.search_placeholder_avatar')
            : t('view.search.search_placeholder');

    async function runUserSearch(nextRequest) {
        const sequence = searchSequenceRef.current.user + 1;
        searchSequenceRef.current.user = sequence;
        setIsUserLoading(true);
        setUserRequest(nextRequest);

        try {
            const response = await vrchatSearchRepository.getUsers(
                nextRequest.params
            );
            if (searchSequenceRef.current.user !== sequence) {
                return;
            }
            setUserResults(
                dedupeById(response.json).map((user) =>
                    userProfileRepository.normalize(user)
                )
            );
        } catch (error) {
            if (searchSequenceRef.current.user === sequence) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.search.generated_toast.failed_to_search_users'
                          )
                );
            }
        } finally {
            if (searchSequenceRef.current.user === sequence) {
                setIsUserLoading(false);
            }
        }
    }

    async function runWorldSearch(nextRequest) {
        const sequence = searchSequenceRef.current.world + 1;
        searchSequenceRef.current.world = sequence;
        setIsWorldLoading(true);
        setWorldRequest(nextRequest);

        try {
            const response = await vrchatSearchRepository.getWorlds(
                nextRequest.params,
                nextRequest.option
            );
            if (searchSequenceRef.current.world !== sequence) {
                return;
            }
            setWorldResults(
                dedupeById(response.json).map((world) =>
                    worldProfileRepository.normalize(world)
                )
            );
        } catch (error) {
            if (searchSequenceRef.current.world === sequence) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.search.generated_toast.failed_to_search_worlds'
                          )
                );
            }
        } finally {
            if (searchSequenceRef.current.world === sequence) {
                setIsWorldLoading(false);
            }
        }
    }

    async function runGroupSearch(nextRequest) {
        const sequence = searchSequenceRef.current.group + 1;
        searchSequenceRef.current.group = sequence;
        setIsGroupLoading(true);
        setGroupRequest(nextRequest);

        try {
            const response = await vrchatSearchRepository.getGroups(
                nextRequest.params
            );
            if (searchSequenceRef.current.group !== sequence) {
                return;
            }
            setGroupResults(dedupeById(response.json));
        } catch (error) {
            if (searchSequenceRef.current.group === sequence) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.search.generated_toast.failed_to_search_groups'
                          )
                );
            }
        } finally {
            if (searchSequenceRef.current.group === sequence) {
                setIsGroupLoading(false);
            }
        }
    }

    async function runAvatarSearch(nextRequest) {
        const sequence = searchSequenceRef.current.avatar + 1;
        searchSequenceRef.current.avatar = sequence;
        setIsAvatarLoading(true);
        setAvatarRequest(nextRequest);

        try {
            const response =
                await avatarSearchProviderRepository.search(nextRequest);
            if (searchSequenceRef.current.avatar !== sequence) {
                return;
            }
            setAvatarResults(response.avatars);
            setAvatarRequest({
                ...nextRequest,
                offset: 0
            });
        } catch (error) {
            if (searchSequenceRef.current.avatar === sequence) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.search.generated_toast.failed_to_search_avatars'
                          )
                );
            }
        } finally {
            if (searchSequenceRef.current.avatar === sequence) {
                setIsAvatarLoading(false);
            }
        }
    }

    function handleSearch() {
        if (activeTab === 'user') {
            void runUserSearch(
                buildUserSearchRequest(
                    searchText,
                    searchUserByBio,
                    searchUserSortByLastLoggedIn
                )
            );
            return;
        }

        if (activeTab === 'world') {
            const category =
                worldCategories.find(
                    (row) => String(row.index) === selectedWorldCategory
                ) ?? null;
            void runWorldSearch(
                buildWorldSearchRequest(
                    searchText,
                    category,
                    includeCommunityLabs
                )
            );
            return;
        }

        if (activeTab === 'group') {
            void runGroupSearch(buildGroupSearchRequest(searchText));
            return;
        }

        if (activeTab === 'avatar') {
            if (searchText.trim().length < 3) {
                toast.warning(t('view.search.avatar.min_chars_warning'));
                return;
            }
            if (!avatarProviderEnabled || !selectedAvatarProvider) {
                toast.warning(t('view.search.avatar.no_provider'));
                return;
            }
            void runAvatarSearch(
                buildAvatarSearchRequest(searchText, selectedAvatarProvider)
            );
        }
    }

    function handleClearSearch() {
        searchSequenceRef.current.user += 1;
        searchSequenceRef.current.world += 1;
        searchSequenceRef.current.group += 1;
        searchSequenceRef.current.avatar += 1;
        setIsUserLoading(false);
        setIsWorldLoading(false);
        setIsGroupLoading(false);
        setIsAvatarLoading(false);
        setSearchText('');
        setUserResults([]);
        setWorldResults([]);
        setGroupResults([]);
        setAvatarResults([]);
        setUserRequest(null);
        setWorldRequest(null);
        setGroupRequest(null);
        setAvatarRequest(null);
    }

    function handleAvatarProviderChange(provider) {
        setSelectedAvatarProvider(provider);
        void avatarSearchProviderRepository
            .saveSelectedProvider(provider)
            .catch((error) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.search.generated_toast.failed_to_save_avatar_provider'
                          )
                );
            });
    }

    function handleWorldCategoryChange(value) {
        setSelectedWorldCategory(value);
        const category =
            worldCategories.find((row) => String(row.index) === value) ?? null;
        void runWorldSearch(
            buildWorldSearchRequest(searchText, category, includeCommunityLabs)
        );
    }

    const pagination = useSearchPagination({
        activeTab,
        avatarRequest,
        avatarResults,
        groupRequest,
        groupResults,
        isAvatarLoading,
        isGroupLoading,
        isUserLoading,
        isWorldLoading,
        runGroupSearch,
        runUserSearch,
        runWorldSearch,
        setAvatarRequest,
        userRequest,
        userResults,
        worldRequest,
        worldResults
    });
    const avatarOffset = avatarRequest?.offset ?? 0;
    const avatarPageResults = avatarResults.slice(
        avatarOffset,
        avatarOffset + PAGE_SIZE
    );

    return (
        <div className="x-container flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex min-h-0 flex-1 flex-col"
            >
                <SearchPageToolbar
                    t={t}
                    searchText={searchText}
                    searchPlaceholder={searchPlaceholder}
                    onSearchTextChange={setSearchText}
                    onSearch={handleSearch}
                    onClearSearch={handleClearSearch}
                />
                <SearchUserTabPanel
                    t={t}
                    searchUserByBio={searchUserByBio}
                    onSearchUserByBioChange={setSearchUserByBio}
                    searchUserSortByLastLoggedIn={searchUserSortByLastLoggedIn}
                    onSearchUserSortByLastLoggedInChange={
                        setSearchUserSortByLastLoggedIn
                    }
                    isLoading={isUserLoading}
                    results={userResults}
                    randomUserColours={randomUserColours}
                    isDarkMode={isDarkMode}
                    pagination={pagination}
                />
                <SearchWorldTabPanel
                    t={t}
                    includeCommunityLabs={includeCommunityLabs}
                    onIncludeCommunityLabsChange={setIncludeCommunityLabs}
                    selectedWorldCategory={selectedWorldCategory}
                    onWorldCategoryChange={handleWorldCategoryChange}
                    worldCategories={worldCategories}
                    isLoading={isWorldLoading}
                    results={worldResults}
                    pagination={pagination}
                />
                <SearchAvatarTabPanel
                    t={t}
                    avatarProviderList={avatarProviderList}
                    selectedAvatarProvider={selectedAvatarProvider}
                    onAvatarProviderChange={handleAvatarProviderChange}
                    onOpenAvatarProviderSettings={() =>
                        setIsAvatarProviderDialogOpen(true)
                    }
                    isLoading={isAvatarLoading}
                    results={avatarPageResults}
                    pagination={pagination}
                />
                <SearchGroupTabPanel
                    isLoading={isGroupLoading}
                    results={groupResults}
                    pagination={pagination}
                />
            </Tabs>
            <AvatarProviderSettingsDialog
                open={isAvatarProviderDialogOpen}
                onOpenChange={setIsAvatarProviderDialogOpen}
                providerList={avatarProviderList}
                onConfigSaved={applyAvatarProviderConfig}
            />
        </div>
    );
}
