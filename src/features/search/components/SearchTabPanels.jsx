import { SettingsIcon } from 'lucide-react';

import { SearchPagination } from '@/components/search/SearchPagination.jsx';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { TabsContent } from '@/ui/shadcn/tabs';

import {
    AvatarCard,
    GroupRow,
    SearchEmptyState,
    SearchLoadingState,
    UserRow,
    WorldCard
} from './SearchResultParts.jsx';

export function SearchUserTabPanel({
    t,
    searchUserByBio,
    onSearchUserByBioChange,
    searchUserSortByLastLoggedIn,
    onSearchUserSortByLastLoggedInChange,
    isLoading,
    results,
    randomUserColours,
    isDarkMode,
    pagination
}) {
    return (
        <TabsContent
            value="user"
            forceMount
            className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
            <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                <FieldGroup
                    data-slot="checkbox-group"
                    className="mb-3 flex shrink-0 flex-row flex-wrap justify-end gap-4"
                >
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
                </FieldGroup>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <SearchLoadingState />
                    ) : results.length > 0 ? (
                        <div>
                            {results.map((user) => (
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
    );
}

export function SearchWorldTabPanel({
    t,
    includeCommunityLabs,
    onIncludeCommunityLabsChange,
    selectedWorldCategory,
    onWorldCategoryChange,
    worldCategories,
    isLoading,
    results,
    pagination
}) {
    return (
        <TabsContent
            value="world"
            forceMount
            className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
            <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                <div className="mb-4 flex w-full shrink-0 justify-end gap-2">
                    <FieldGroup
                        data-slot="checkbox-group"
                        className="w-auto flex-row items-center gap-2"
                    >
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="search-world-community-lab"
                                checked={includeCommunityLabs}
                                onCheckedChange={(checked) =>
                                    onIncludeCommunityLabsChange(checked === true)
                                }
                            />
                            <FieldLabel htmlFor="search-world-community-lab">
                                {t('view.search.world.community_lab')}
                            </FieldLabel>
                        </Field>
                    </FieldGroup>
                    <Select
                        value={selectedWorldCategory}
                        onValueChange={onWorldCategoryChange}
                    >
                        <SelectTrigger size="sm">
                            <SelectValue
                                placeholder={t('view.search.world.category')}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {worldCategories.map((row) => (
                                    <SelectItem
                                        key={row.index}
                                        value={String(row.index)}
                                    >
                                        {row.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <SearchLoadingState />
                    ) : results.length > 0 ? (
                        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))] gap-3">
                            {results.map((world) => (
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
    );
}

export function SearchAvatarTabPanel({
    t,
    avatarProviderList,
    selectedAvatarProvider,
    onAvatarProviderChange,
    onOpenAvatarProviderSettings,
    isLoading,
    results,
    pagination
}) {
    return (
        <TabsContent
            value="avatar"
            forceMount
            className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
            <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
                    {avatarProviderList.length > 0 ? (
                        <Select
                            value={selectedAvatarProvider}
                            onValueChange={onAvatarProviderChange}
                        >
                            <SelectTrigger size="sm">
                                <SelectValue
                                    placeholder={t(
                                        'view.search.avatar.search_provider'
                                    )}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {avatarProviderList
                                        .filter(Boolean)
                                        .map((provider) => (
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
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={'Search Provider'}
                        onClick={onOpenAvatarProviderSettings}
                    >
                        <SettingsIcon data-icon="inline-start" />
                    </Button>
                </div>

                <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <SearchLoadingState />
                    ) : results.length > 0 ? (
                        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))] gap-3">
                            {results.map((avatar) => (
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
    );
}

export function SearchGroupTabPanel({
    isLoading,
    results,
    pagination
}) {
    return (
        <TabsContent
            value="group"
            forceMount
            className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
            <div
                className="min-h-0 flex-1 overflow-y-auto"
                style={{ flex: 9 }}
            >
                {isLoading ? (
                    <SearchLoadingState />
                ) : results.length > 0 ? (
                    <div>
                        {results.map((group) => (
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
    );
}
