import { SettingsIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    ToolbarActions,
    ToolbarOverflowMenu,
    ToolbarSearch,
    ToolbarTabs,
    ToolbarViewMenu,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import type { SearchActiveTab, SearchWorldCategory } from '../searchTypes';

type SearchViewOptions = {
    avatarProviderList: string[];
    includeCommunityLabs: boolean;
    onAvatarProviderChange: (value: string | null) => void;
    onIncludeCommunityLabsChange: (value: boolean) => void;
    onOpenAvatarProviderSettings: () => void;
    onSearchUserByBioChange: (value: boolean) => void;
    onSearchUserSortByLastLoggedInChange: (value: boolean) => void;
    onWorldCategoryChange: (value: string | null) => void;
    searchUserByBio: boolean;
    searchUserSortByLastLoggedIn: boolean;
    selectedAvatarProvider: string;
    selectedWorldCategory: string;
    worldCategories: SearchWorldCategory[];
};

function SearchViewOptionsMenu({
    activeTab,
    options
}: {
    activeTab: SearchActiveTab;
    options: SearchViewOptions;
}) {
    const { t } = useTranslation();
    const {
        avatarProviderList,
        includeCommunityLabs,
        onAvatarProviderChange,
        onIncludeCommunityLabsChange,
        onOpenAvatarProviderSettings,
        onSearchUserByBioChange,
        onSearchUserSortByLastLoggedInChange,
        onWorldCategoryChange,
        searchUserByBio,
        searchUserSortByLastLoggedIn,
        selectedAvatarProvider,
        selectedWorldCategory,
        worldCategories
    } = options;
    const availableProviders = avatarProviderList.filter(Boolean);

    if (activeTab === 'group') {
        return null;
    }

    return (
        <ToolbarViewMenu contentClassName="p-3">
            <FieldGroup onClick={(event) => event.stopPropagation()}>
                {activeTab === 'user' ? (
                    <>
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="search-user-by-bio"
                                checked={searchUserByBio}
                                onCheckedChange={(checked) =>
                                    onSearchUserByBioChange(checked === true)
                                }
                            />
                            <FieldLabel htmlFor="search-user-by-bio">
                                {t('view.search.user.search_by_bio')}
                            </FieldLabel>
                        </Field>
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="search-user-sort-by-last-logged-in"
                                checked={searchUserSortByLastLoggedIn}
                                onCheckedChange={(checked) =>
                                    onSearchUserSortByLastLoggedInChange(
                                        checked === true
                                    )
                                }
                            />
                            <FieldLabel htmlFor="search-user-sort-by-last-logged-in">
                                {t('view.search.user.sort_by_last_logged_in')}
                            </FieldLabel>
                        </Field>
                    </>
                ) : null}

                {activeTab === 'world' ? (
                    <>
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="search-world-community-lab"
                                checked={includeCommunityLabs}
                                onCheckedChange={(checked) =>
                                    onIncludeCommunityLabsChange(
                                        checked === true
                                    )
                                }
                            />
                            <FieldLabel htmlFor="search-world-community-lab">
                                {t('view.search.world.community_lab')}
                            </FieldLabel>
                        </Field>
                        <Field>
                            <FieldLabel>
                                {t('view.search.world.category')}
                            </FieldLabel>
                            <Select
                                value={selectedWorldCategory}
                                items={worldCategories.map((row) => ({
                                    value: String(row.index),
                                    label: row.name || String(row.index)
                                }))}
                                onValueChange={onWorldCategoryChange}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue
                                        placeholder={t(
                                            'view.search.world.category'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {worldCategories.map((row) => (
                                            <SelectItem
                                                key={row.index}
                                                value={String(row.index)}
                                            >
                                                {row.name || String(row.index)}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </>
                ) : null}

                {activeTab === 'avatar' ? (
                    <Field>
                        <FieldLabel>
                            {t('view.search.avatar.search_provider')}
                        </FieldLabel>
                        {availableProviders.length ? (
                            <Select
                                value={selectedAvatarProvider}
                                items={availableProviders.map((provider) => ({
                                    value: provider,
                                    label: provider
                                }))}
                                onValueChange={onAvatarProviderChange}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue
                                        placeholder={t(
                                            'view.search.avatar.search_provider'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {availableProviders.map((provider) => (
                                            <SelectItem
                                                key={provider}
                                                value={provider}
                                            >
                                                {provider}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        ) : (
                            <span className="text-muted-foreground text-sm">
                                {t('view.search.avatar.no_provider')}
                            </span>
                        )}
                    </Field>
                ) : null}
            </FieldGroup>

            {activeTab === 'avatar' ? (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onClick={onOpenAvatarProviderSettings}
                        >
                            <SettingsIcon data-icon="inline-start" />
                            {t('view.search.avatar.search_provider')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </>
            ) : null}
        </ToolbarViewMenu>
    );
}

export function SearchControlBand({
    activeTab,
    searchText,
    onSearchTextChange,
    onSearch,
    onClearSearch,
    viewOptions
}: {
    activeTab: SearchActiveTab;
    searchText: string;
    onSearchTextChange: (value: string) => void;
    onSearch: () => void;
    onClearSearch: () => void;
    viewOptions: SearchViewOptions;
}) {
    const { t } = useTranslation();
    const searchPlaceholder =
        activeTab === 'avatar'
            ? t('view.search.avatar.search_placeholder_avatar')
            : t('view.search.search_placeholder');
    const tabOptions: ToolbarSegmentOption<SearchActiveTab>[] = [
        { value: 'user', label: t('view.search.user.header') },
        { value: 'world', label: t('view.search.world.header') },
        { value: 'avatar', label: t('view.search.avatar.header') },
        { value: 'group', label: t('view.search.group.header') }
    ];

    return (
        <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-2 px-1 pb-3">
            <ToolbarSearch
                value={searchText}
                onValueChange={onSearchTextChange}
                onCommit={onSearch}
                commitOnBlur={false}
                autoFocus={!searchText}
                placeholder={searchPlaceholder}
                className="h-10 w-full sm:w-full"
            />
            <div className="flex min-w-0 items-center gap-2">
                <ToolbarTabs options={tabOptions} />
                <ToolbarActions className="ms-auto">
                    <SearchViewOptionsMenu
                        activeTab={activeTab}
                        options={viewOptions}
                    />
                    <ToolbarOverflowMenu>
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={onClearSearch}>
                                <Trash2Icon data-icon="inline-start" />
                                {t('view.search.clear_results_tooltip')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </ToolbarOverflowMenu>
                </ToolbarActions>
            </div>
        </div>
    );
}
