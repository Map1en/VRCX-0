import { SearchPagination } from '@/components/search/SearchPagination';
import { cn } from '@/lib/utils';
import type { LanguageOption } from '@/shared/utils/userLanguage';
import { usePreferencesStore } from '@/state/preferencesStore';
import { TabsContent } from '@/ui/shadcn/tabs';

import type {
    SearchAvatarResult,
    SearchGroupResult,
    SearchPaginationState,
    SearchUserResult,
    SearchWorldResult
} from '../searchTypes';
import {
    AvatarCard,
    GroupRow,
    SearchEmptyState,
    SearchLoadingState,
    UserRow,
    WorldCard
} from './SearchResultParts';

export function SearchUserTabPanel({
    isLoading,
    results,
    languageOptionsMap,
    pagination,
    searched,
    onClear
}: {
    isLoading: boolean;
    results: SearchUserResult[];
    languageOptionsMap: ReadonlyMap<string, LanguageOption>;
    pagination: SearchPaginationState;
    searched: boolean;
    onClear: () => void;
}) {
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    return (
        <TabsContent
            value="user"
            keepMounted
            className="relative m-0 flex min-h-0 flex-1 flex-col data-hidden:hidden"
        >
            <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                <div
                    className={cn(
                        'flex min-h-0 flex-1 flex-col overflow-y-auto',
                        pagination.show && 'pb-14'
                    )}
                >
                    {isLoading ? (
                        <SearchLoadingState />
                    ) : results.length > 0 ? (
                        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3">
                            {results.map((user) => (
                                <UserRow
                                    key={user.id}
                                    user={user}
                                    randomUserColours={randomUserColours}
                                    isDarkMode={isDarkMode}
                                    languageOptionsMap={languageOptionsMap}
                                />
                            ))}
                        </div>
                    ) : (
                        <SearchEmptyState
                            kind="user"
                            searched={searched}
                            onClear={onClear}
                        />
                    )}
                </div>
            </div>
            <SearchPagination
                show={pagination.show}
                page={pagination.page}
                prevDisabled={pagination.prevDisabled}
                nextDisabled={pagination.nextDisabled}
                onPrev={pagination.onPrev}
                onNext={pagination.onNext}
            />
        </TabsContent>
    );
}

export function SearchWorldTabPanel({
    isLoading,
    results,
    pagination,
    searched,
    onClear
}: {
    isLoading: boolean;
    results: SearchWorldResult[];
    pagination: SearchPaginationState;
    searched: boolean;
    onClear: () => void;
}) {
    return (
        <TabsContent
            value="world"
            keepMounted
            className="relative m-0 flex min-h-0 flex-1 flex-col data-hidden:hidden"
        >
            <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                <div
                    className={cn(
                        'flex min-h-0 flex-1 flex-col overflow-y-auto',
                        pagination.show && 'pb-14'
                    )}
                >
                    {isLoading ? (
                        <SearchLoadingState />
                    ) : results.length > 0 ? (
                        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))] gap-4">
                            {results.map((world) => (
                                <WorldCard key={world.id} world={world} />
                            ))}
                        </div>
                    ) : (
                        <SearchEmptyState
                            kind="world"
                            searched={searched}
                            onClear={onClear}
                        />
                    )}
                </div>
            </div>
            <SearchPagination
                show={pagination.show}
                page={pagination.page}
                prevDisabled={pagination.prevDisabled}
                nextDisabled={pagination.nextDisabled}
                onPrev={pagination.onPrev}
                onNext={pagination.onNext}
            />
        </TabsContent>
    );
}

export function SearchAvatarTabPanel({
    isLoading,
    results,
    pagination,
    searched,
    avatarProviderConfigured,
    onClear,
    onConfigureAvatarProvider
}: {
    isLoading: boolean;
    results: SearchAvatarResult[];
    pagination: SearchPaginationState;
    searched: boolean;
    avatarProviderConfigured: boolean;
    onClear: () => void;
    onConfigureAvatarProvider: () => void;
}) {
    return (
        <TabsContent
            value="avatar"
            keepMounted
            className="relative m-0 flex min-h-0 flex-1 flex-col data-hidden:hidden"
        >
            <div className="flex min-h-0 flex-col" style={{ flex: 9 }}>
                <div
                    className={cn(
                        'flex min-h-0 flex-1 flex-col overflow-y-auto',
                        pagination.show && 'pb-14'
                    )}
                >
                    {isLoading ? (
                        <SearchLoadingState />
                    ) : results.length > 0 ? (
                        <div className="grid [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))] gap-4">
                            {results.map((avatar) => (
                                <AvatarCard key={avatar.id} avatar={avatar} />
                            ))}
                        </div>
                    ) : (
                        <SearchEmptyState
                            kind="avatar"
                            searched={searched}
                            avatarProviderConfigured={avatarProviderConfigured}
                            onClear={onClear}
                            onConfigureAvatarProvider={
                                onConfigureAvatarProvider
                            }
                        />
                    )}
                </div>
            </div>
            <SearchPagination
                show={pagination.show}
                page={pagination.page}
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
    pagination,
    searched,
    onClear
}: {
    isLoading: boolean;
    results: SearchGroupResult[];
    pagination: SearchPaginationState;
    searched: boolean;
    onClear: () => void;
}) {
    return (
        <TabsContent
            value="group"
            keepMounted
            className="relative m-0 flex min-h-0 flex-1 flex-col data-hidden:hidden"
        >
            <div
                className={cn(
                    'flex min-h-0 flex-1 flex-col overflow-y-auto',
                    pagination.show && 'pb-14'
                )}
                style={{ flex: 9 }}
            >
                {isLoading ? (
                    <SearchLoadingState />
                ) : results.length > 0 ? (
                    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3">
                        {results.map((group) => (
                            <GroupRow key={group.id} group={group} />
                        ))}
                    </div>
                ) : (
                    <SearchEmptyState
                        kind="group"
                        searched={searched}
                        onClear={onClear}
                    />
                )}
            </div>
            <SearchPagination
                show={pagination.show}
                page={pagination.page}
                prevDisabled={pagination.prevDisabled}
                nextDisabled={pagination.nextDisabled}
                onPrev={pagination.onPrev}
                onNext={pagination.onNext}
            />
        </TabsContent>
    );
}
