import { useEffect, useMemo, useRef, useState } from 'react';
import {
    GlobeIcon,
    LoaderCircleIcon,
    SettingsIcon,
    Trash2Icon,
    UserIcon,
    UsersIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { AvatarProviderSettingsDialog } from '@/components/search/AvatarProviderSettingsDialog.jsx';
import { SearchPagination } from '@/components/search/SearchPagination.jsx';
import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import {
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
    avatarSearchProviderRepository,
    configRepository,
    userProfileRepository,
    vrchatSearchRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import { languageMappings } from '@/shared/constants/language.js';
import { convertFileUrlToImageUrl, getNameColour, userImage } from '@/lib/entityMedia.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/shadcn/select.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';

const PAGE_SIZE = 10;

function emptyArray(value) {
    return Array.isArray(value) ? value : [];
}

function dedupeById(items) {
    const map = new Map();
    for (const item of emptyArray(items)) {
        if (item?.id) {
            map.set(item.id, item);
        }
    }
    return Array.from(map.values());
}

function resolveUserLanguages(user) {
    if (Array.isArray(user?.$languages) && user.$languages.length) {
        return user.$languages;
    }

    const tags = Array.isArray(user?.tags) ? user.tags : [];
    return tags
        .filter((tag) => typeof tag === 'string' && tag.startsWith('language_'))
        .map((tag) => {
            const key = tag.slice('language_'.length);
            return {
                key,
                value: languageMappings[key] || key
            };
        })
        .filter((entry) => entry.key);
}

function languageFlagLabel(languageKey) {
    const countryCode = languageMappings[String(languageKey || '').toLowerCase()];
    if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) {
        return String(languageKey || '?').slice(0, 3).toUpperCase() || '?';
    }

    return String.fromCodePoint(
        ...countryCode
            .toUpperCase()
            .split('')
            .map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
    );
}

function buildWorldSearchRequest(searchText, category, includeCommunityLabs, offset = 0) {
    const params = {
        n: PAGE_SIZE,
        offset: Math.max(0, offset)
    };
    let option;

    switch (category?.sortHeading) {
        case 'featured':
            params.sort = 'order';
            params.featured = 'true';
            break;
        case 'trending':
            params.sort = 'popularity';
            params.featured = 'false';
            break;
        case 'updated':
            params.sort = 'updated';
            break;
        case 'created':
            params.sort = 'created';
            break;
        case 'publication':
            params.sort = 'publicationDate';
            break;
        case 'shuffle':
            params.sort = 'shuffle';
            break;
        case 'active':
            option = 'active';
            break;
        case 'recent':
            option = 'recent';
            break;
        case 'favorite':
            option = 'favorites';
            break;
        case 'labs':
            params.sort = 'labsPublicationDate';
            break;
        case 'heat':
            params.sort = 'heat';
            params.featured = 'false';
            break;
        default:
            params.sort = 'relevance';
            params.search = replaceBioSymbols(searchText);
            break;
    }

    params.order = category?.sortOrder || 'descending';

    if (category?.sortOwnership === 'mine') {
        params.user = 'me';
        params.releaseStatus = 'all';
    }

    if (category?.tag) {
        params.tag = category.tag;
    }

    if (!includeCommunityLabs) {
        params.tag = params.tag ? `${params.tag},system_approved` : 'system_approved';
    }

    return {
        categoryIndex: category?.index ?? null,
        option,
        params
    };
}

function buildGroupSearchRequest(searchText, offset = 0) {
    return {
        params: {
            n: PAGE_SIZE,
            offset: Math.max(0, offset),
            query: replaceBioSymbols(searchText)
        }
    };
}

function buildAvatarSearchRequest(searchText, provider, offset = 0) {
    return {
        provider,
        query: replaceBioSymbols(searchText),
        offset: Math.max(0, offset)
    };
}

function buildUserSearchRequest(
    searchText,
    searchByBio = false,
    sortByLastLoggedIn = false,
    offset = 0
) {
    return {
        params: {
            n: PAGE_SIZE,
            offset: Math.max(0, offset),
            search: replaceBioSymbols(searchText),
            customFields: searchByBio ? 'bio' : 'displayName',
            sort: sortByLastLoggedIn ? 'last_login' : 'relevance'
        }
    };
}

function SearchEmptyState() {
    return (
        <div className="flex h-full min-h-56 items-center justify-center text-sm text-muted-foreground">
            No data
        </div>
    );
}

function SearchLoadingState() {
    return (
        <div className="flex h-full min-h-56 items-center justify-center">
            <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
        </div>
    );
}

function AvatarCard({ avatar }) {
    const imageUrl = avatar.thumbnailImageUrl || avatar.imageUrl;

    return (
        <button
            type="button"
            className="min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
            onClick={() =>
                openAvatarDialog({
                    avatarId: avatar.id,
                    title: avatar.name || undefined,
                    seedData: avatar
                })
            }>
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt={avatar.name}
                    loading="lazy"
                    className="aspect-[16/10] w-full rounded-lg object-cover"
                />
            ) : (
                <div className="flex aspect-[16/10] w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <UserIcon className="size-8" />
                </div>
            )}
            <div className="mt-2 min-w-0 space-y-1">
                <div className="truncate text-sm font-medium">{avatar.name || ''}</div>
                <div className="truncate text-xs text-muted-foreground">
                    {avatar.authorName || ''}
                </div>
            </div>
        </button>
    );
}

function WorldCard({ world }) {
    return (
        <button
            type="button"
            className="min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
            onClick={() =>
                openWorldDialog({
                    worldId: world.id,
                    title: world.name || undefined,
                    seedData: world
                })
            }>
            {world.thumbnailImageUrl ? (
                <img
                    src={world.thumbnailImageUrl}
                    alt={world.name}
                    loading="lazy"
                    className="aspect-[16/10] w-full rounded-lg object-cover"
                />
            ) : (
                <div className="flex aspect-[16/10] w-full items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <GlobeIcon className="size-8" />
                </div>
            )}
            <div className="mt-2 min-w-0 space-y-1">
                <div className="truncate text-sm font-medium">{world.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                    {world.occupants
                        ? `${world.authorName || ''} (${world.occupants})`
                        : world.authorName || ''}
                </div>
            </div>
        </button>
    );
}

function UserRow({ user, randomUserColours, isDarkMode }) {
    const imageUrl = userImage(user, true);
    const languages = resolveUserLanguages(user);
    const trustStyle =
        randomUserColours && user?.id
            ? { color: getNameColour(user.id, isDarkMode) }
            : user?.$userColour
                ? { color: user.$userColour }
                : undefined;

    return (
        <button
            type="button"
            className="flex w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors hover:bg-muted/40"
            onClick={() =>
                openUserDialog({
                    userId: user.id,
                    title: user.displayName || user.username || undefined,
                    seedData: user
                })
            }>
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt={user.displayName || user.id}
                    loading="lazy"
                    className="size-14 rounded-full object-cover"
                />
            ) : (
                <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserIcon className="size-5" />
                </div>
            )}
            <div className="min-w-0 flex-1">
                <div className="flex max-w-full items-center gap-1.5">
                    <div className="truncate text-sm font-medium">
                        {user.displayName || ''}
                    </div>
                    <span
                        className={`shrink-0 text-xs font-normal ${user.$trustClass || 'text-muted-foreground'}`}
                        style={trustStyle}>
                        {user.$trustLevel || ''}
                    </span>
                    {languages.map((entry) => (
                        <span
                            key={`${user.id}-${entry.key}-${entry.value}`}
                            className="shrink-0 text-sm leading-none"
                            title={entry.value || entry.key}>
                            {languageFlagLabel(entry.key)}
                        </span>
                    ))}
                </div>
                {user.bio ? (
                    <div className="line-clamp-1 text-xs text-muted-foreground">
                        {user.bio}
                    </div>
                ) : null}
            </div>
        </button>
    );
}

function GroupRow({ group }) {
    const imageUrl = convertFileUrlToImageUrl(group.iconUrl);
    const groupCode =
        group.shortCode && group.discriminator
            ? `${group.shortCode}.${group.discriminator}`
            : group.shortCode || group.discriminator || null;

    return (
        <button
            type="button"
            className="flex w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors hover:bg-muted/40"
            onClick={() =>
                openGroupDialog({
                    groupId: group.id,
                    title: group.name || undefined,
                    seedData: group
                })
            }>
            {imageUrl ? (
                <img
                    src={imageUrl}
                    alt={group.name}
                    loading="lazy"
                    className="size-14 rounded-lg object-cover"
                />
            ) : (
                <div className="flex size-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <UsersIcon className="size-5" />
                </div>
            )}
            <div className="min-w-0 flex-1">
                <div className="flex max-w-full items-center gap-1.5">
                    <div className="truncate text-sm font-medium">{group.name}</div>
                    <span className="shrink-0 text-xs font-normal">({group.memberCount ?? 0})</span>
                    {groupCode ? <span className="shrink-0 font-mono text-xs text-muted-foreground">{groupCode}</span> : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                    {group.description || ''}
                </div>
            </div>
        </button>
    );
}

export function SearchPage() {
    const { t } = useI18n();
    const searchSequenceRef = useRef({
        user: 0,
        world: 0,
        group: 0,
        avatar: 0
    });
    const [activeTab, setActiveTab] = useState('user');
    const [searchText, setSearchText] = useState('');
    const [searchUserByBio, setSearchUserByBio] = useState(false);
    const [searchUserSortByLastLoggedIn, setSearchUserSortByLastLoggedIn] = useState(false);
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
    const [isAvatarProviderDialogOpen, setIsAvatarProviderDialogOpen] = useState(false);
    const randomUserColours = usePreferencesStore((state) => state.randomUserColours);
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

                setWorldCategories(emptyArray(json?.dynamicWorldRows).filter((row) => row?.index != null));
            })
            .catch((error) => {
                toast.error(error instanceof Error ? error.message : 'Failed to load world categories.');
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const unsubscribe = onPreferenceChanged(AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS, () => {
            avatarSearchProviderRepository
                .getConfig()
                .then((config) => {
                    if (active) {
                        applyAvatarProviderConfig(config);
                    }
                })
                .catch((error) => {
                    console.warn('Failed to refresh avatar providers:', error);
                });
        });

        avatarSearchProviderRepository
            .getConfig()
            .then((config) => {
                if (!active) {
                    return;
                }

                applyAvatarProviderConfig(config);
            })
            .catch((error) => {
                toast.error(error instanceof Error ? error.message : 'Failed to load avatar providers.');
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
            const response = await vrchatSearchRepository.getUsers(nextRequest.params);
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
                toast.error(error instanceof Error ? error.message : 'Failed to search users.');
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
                toast.error(error instanceof Error ? error.message : 'Failed to search worlds.');
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
            const response = await vrchatSearchRepository.getGroups(nextRequest.params);
            if (searchSequenceRef.current.group !== sequence) {
                return;
            }
            setGroupResults(dedupeById(response.json));
        } catch (error) {
            if (searchSequenceRef.current.group === sequence) {
                toast.error(error instanceof Error ? error.message : 'Failed to search groups.');
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
            const response = await avatarSearchProviderRepository.search(nextRequest);
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
                toast.error(error instanceof Error ? error.message : 'Failed to search avatars.');
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
                worldCategories.find((row) => String(row.index) === selectedWorldCategory) ?? null;
            void runWorldSearch(buildWorldSearchRequest(searchText, category, includeCommunityLabs));
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
            void runAvatarSearch(buildAvatarSearchRequest(searchText, selectedAvatarProvider));
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
                toast.error(error instanceof Error ? error.message : 'Failed to save avatar provider.');
            });
    }

    function handleWorldCategoryChange(value) {
        setSelectedWorldCategory(value);
        const category =
            worldCategories.find((row) => String(row.index) === value) ?? null;
        void runWorldSearch(buildWorldSearchRequest(searchText, category, includeCommunityLabs));
    }

    const pagination = useMemo(() => {
        if (activeTab === 'user') {
            return {
                show: userResults.length > 0 && !isUserLoading,
                prevDisabled: !userRequest?.params?.offset,
                nextDisabled: userResults.length < (userRequest?.params?.n ?? PAGE_SIZE),
                onPrev() {
                    if (!userRequest) {
                        return;
                    }
                    const offset = Math.max(0, (userRequest.params.offset ?? 0) - (userRequest.params.n ?? PAGE_SIZE));
                    void runUserSearch({
                        ...userRequest,
                        params: {
                            ...userRequest.params,
                            offset
                        }
                    });
                },
                onNext() {
                    if (!userRequest) {
                        return;
                    }
                    const step = userRequest.params.n ?? PAGE_SIZE;
                    void runUserSearch({
                        ...userRequest,
                        params: {
                            ...userRequest.params,
                            offset: (userRequest.params.offset ?? 0) + step
                        }
                    });
                }
            };
        }

        if (activeTab === 'world') {
            return {
                show: worldResults.length > 0 && !isWorldLoading,
                prevDisabled: !worldRequest?.params?.offset,
                nextDisabled: worldResults.length < (worldRequest?.params?.n ?? PAGE_SIZE),
                onPrev() {
                    if (!worldRequest) {
                        return;
                    }
                    const offset = Math.max(0, (worldRequest.params.offset ?? 0) - (worldRequest.params.n ?? PAGE_SIZE));
                    void runWorldSearch({
                        ...worldRequest,
                        params: {
                            ...worldRequest.params,
                            offset
                        }
                    });
                },
                onNext() {
                    if (!worldRequest) {
                        return;
                    }
                    const step = worldRequest.params.n ?? PAGE_SIZE;
                    void runWorldSearch({
                        ...worldRequest,
                        params: {
                            ...worldRequest.params,
                            offset: (worldRequest.params.offset ?? 0) + step
                        }
                    });
                }
            };
        }

        if (activeTab === 'group') {
            return {
                show: groupResults.length > 0 && !isGroupLoading,
                prevDisabled: !groupRequest?.params?.offset,
                nextDisabled: groupResults.length < (groupRequest?.params?.n ?? PAGE_SIZE),
                onPrev() {
                    if (!groupRequest) {
                        return;
                    }
                    const offset = Math.max(0, (groupRequest.params.offset ?? 0) - (groupRequest.params.n ?? PAGE_SIZE));
                    void runGroupSearch({
                        ...groupRequest,
                        params: {
                            ...groupRequest.params,
                            offset
                        }
                    });
                },
                onNext() {
                    if (!groupRequest) {
                        return;
                    }
                    const step = groupRequest.params.n ?? PAGE_SIZE;
                    void runGroupSearch({
                        ...groupRequest,
                        params: {
                            ...groupRequest.params,
                            offset: (groupRequest.params.offset ?? 0) + step
                        }
                    });
                }
            };
        }

        if (activeTab === 'avatar') {
            const offset = avatarRequest?.offset ?? 0;
            return {
                show: avatarResults.length > 0 && !isAvatarLoading,
                prevDisabled: offset <= 0,
                nextDisabled: offset + PAGE_SIZE >= avatarResults.length,
                onPrev() {
                    if (!avatarRequest) {
                        return;
                    }
                    setAvatarRequest({
                        ...avatarRequest,
                        offset: Math.max(0, offset - PAGE_SIZE)
                    });
                },
                onNext() {
                    if (!avatarRequest) {
                        return;
                    }
                    setAvatarRequest({
                        ...avatarRequest,
                        offset: offset + PAGE_SIZE
                    });
                }
            };
        }

        return {
            show: false,
            prevDisabled: true,
            nextDisabled: true,
            onPrev() {},
            onNext() {}
        };
    }, [
        activeTab,
        avatarRequest,
        avatarResults.length,
        groupRequest,
        groupResults.length,
        isAvatarLoading,
        isGroupLoading,
        isUserLoading,
        isWorldLoading,
        userRequest,
        userResults.length,
        worldRequest,
        worldResults.length
    ]);

    const avatarPageResults = useMemo(() => {
        const offset = avatarRequest?.offset ?? 0;
        return avatarResults.slice(offset, offset + PAGE_SIZE);
    }, [avatarRequest, avatarResults]);

    return (
        <div className="x-container flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2 flex items-center gap-5">
                    <TabsList className="h-auto shrink-0 flex-wrap">
                        <TabsTrigger value="user">
                            {t('view.search.user.header')}
                        </TabsTrigger>
                        <TabsTrigger value="world">
                            {t('view.search.world.header')}
                        </TabsTrigger>
                        <TabsTrigger value="avatar">
                            {t('view.search.avatar.header')}
                        </TabsTrigger>
                        <TabsTrigger value="group">
                            {t('view.search.group.header')}
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex min-w-0 flex-1 items-center">
                        <div className="relative flex min-w-0 flex-1">
                            <Input
                                value={searchText}
                                placeholder={searchPlaceholder}
                                className={`min-w-0 flex-1 ${searchText ? 'pr-8' : ''}`}
                                onChange={(event) => setSearchText(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        handleSearch();
                                    }
                                }}
                            />
                            {searchText ? (
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                                    onClick={() => setSearchText('')}>
                                    <XIcon className="size-3.5" />
                                    <span className="sr-only">Clear input</span>
                                </button>
                            ) : null}
                        </div>
                        <Button
                            type="button"
                            className="ml-2 rounded-full"
                            size="icon"
                            variant="ghost"
                            title={t('view.search.clear_results_tooltip')}
                            onClick={handleClearSearch}>
                            <Trash2Icon className="size-4" />
                            <span className="sr-only">{t('view.search.clear_results_tooltip')}</span>
                        </Button>
                    </div>
                </div>

                <TabsContent value="user" forceMount className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
                    <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                        <div className="mb-3 flex shrink-0 justify-end gap-4">
                            <label className="inline-flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={searchUserByBio}
                                    onCheckedChange={(checked) => setSearchUserByBio(checked === true)}
                                />
                                <span>{t('view.search.user.search_by_bio')}</span>
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={searchUserSortByLastLoggedIn}
                                    onCheckedChange={(checked) => setSearchUserSortByLastLoggedIn(checked === true)}
                                />
                                <span>{t('view.search.user.sort_by_last_logged_in')}</span>
                            </label>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {isUserLoading ? (
                                <SearchLoadingState />
                            ) : userResults.length > 0 ? (
                                <div>
                                    {userResults.map((user) => (
                                        <UserRow
                                            key={user.id}
                                            user={user}
                                            randomUserColours={randomUserColours}
                                            isDarkMode={isDarkMode}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <SearchEmptyState />
                            )}
                        </div>
                    </div>
                    <SearchPagination
                        show={pagination.show}
                        prevDisabled={pagination.prevDisabled}
                        nextDisabled={pagination.nextDisabled}
                        onPrev={pagination.onPrev}
                        onNext={pagination.onNext}
                    />
                </TabsContent>

                <TabsContent value="world" forceMount className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
                    <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                        <div className="mb-4 flex w-full shrink-0 justify-end gap-2">
                            <label className="inline-flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={includeCommunityLabs}
                                    onCheckedChange={(checked) => setIncludeCommunityLabs(checked === true)}
                                />
                                <span>{t('view.search.world.community_lab')}</span>
                            </label>
                            <Select
                                value={selectedWorldCategory}
                                onValueChange={handleWorldCategoryChange}
                            >
                                <SelectTrigger size="sm">
                                    <SelectValue placeholder={t('view.search.world.category')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {worldCategories.map((row) => (
                                        <SelectItem key={row.index} value={String(row.index)}>
                                            {row.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {isWorldLoading ? (
                                <SearchLoadingState />
                            ) : worldResults.length > 0 ? (
                                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                                    {worldResults.map((world) => (
                                        <WorldCard key={world.id} world={world} />
                                    ))}
                                </div>
                            ) : (
                                <SearchEmptyState />
                            )}
                        </div>
                    </div>
                    <SearchPagination
                        show={pagination.show}
                        prevDisabled={pagination.prevDisabled}
                        nextDisabled={pagination.nextDisabled}
                        onPrev={pagination.onPrev}
                        onNext={pagination.onNext}
                    />
                </TabsContent>

                <TabsContent value="avatar" forceMount className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
                    <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                        <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
                            {avatarProviderList.length > 0 ? (
                                <Select
                                    value={selectedAvatarProvider}
                                    onValueChange={handleAvatarProviderChange}
                                >
                                    <SelectTrigger size="sm">
                                        <SelectValue placeholder={t('view.search.avatar.search_provider')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {avatarProviderList.filter(Boolean).map((provider) => (
                                            <SelectItem key={provider} value={provider}>
                                                {provider}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <span className="text-sm text-muted-foreground">
                                    {t('view.search.avatar.no_provider')}
                                </span>
                            )}
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setIsAvatarProviderDialogOpen(true)}>
                                <SettingsIcon className="size-4" />
                            </Button>
                        </div>

                        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
                            {isAvatarLoading ? (
                                <SearchLoadingState />
                            ) : avatarPageResults.length > 0 ? (
                                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                                    {avatarPageResults.map((avatar) => (
                                        <AvatarCard key={avatar.id} avatar={avatar} />
                                    ))}
                                </div>
                            ) : (
                                <SearchEmptyState />
                            )}
                        </div>
                    </div>
                    <SearchPagination
                        show={pagination.show}
                        prevDisabled={pagination.prevDisabled}
                        nextDisabled={pagination.nextDisabled}
                        onPrev={pagination.onPrev}
                        onNext={pagination.onNext}
                    />
                </TabsContent>

                <TabsContent value="group" forceMount className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
                    <div className="min-h-0 flex-1 overflow-y-auto" style={{ flex: 9 }}>
                        {isGroupLoading ? (
                            <SearchLoadingState />
                        ) : groupResults.length > 0 ? (
                            <div>
                                {groupResults.map((group) => (
                                    <GroupRow key={group.id} group={group} />
                                ))}
                            </div>
                        ) : (
                            <SearchEmptyState />
                        )}
                    </div>
                    <SearchPagination
                        show={pagination.show}
                        prevDisabled={pagination.prevDisabled}
                        nextDisabled={pagination.nextDisabled}
                        onPrev={pagination.onPrev}
                        onNext={pagination.onNext}
                    />
                </TabsContent>
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
