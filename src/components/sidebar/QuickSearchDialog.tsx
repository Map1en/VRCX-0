import {
    CompassIcon,
    GlobeIcon,
    PersonStandingIcon,
    UsersIcon
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { setRgb } from '@/services/vrcx0CssLayerService';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut
} from '@/ui/shadcn/command';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import {
    normalizeSearchQuery,
    USER_QUERY_MIN_LENGTH
} from './quick-search/quickSearchResultModel';
import { useQuickSearchCatalogState } from './quick-search/useQuickSearchCatalogState';
import { useQuickSearchResults } from './quick-search/useQuickSearchResults';
import { useQuickSearchSelectResult } from './quick-search/useQuickSearchSelectResult';
import {
    NavResultGroup,
    useNavCommands,
    type QuickSearchNavCommand
} from './QuickSearchNavCommands';
import { ResultGroup } from './QuickSearchResults';

export function QuickSearchDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const normalizedQuery = normalizeSearchQuery(query);
    const navCommands = useNavCommands(normalizedQuery);
    const catalog = useQuickSearchCatalogState({
        currentEndpoint,
        currentUserId,
        open
    });
    const results = useQuickSearchResults({
        catalog,
        normalizedQuery
    });

    const hasResults =
        navCommands.length ||
        results.friends.length ||
        results.ownAvatars.length ||
        results.favoriteAvatars.length ||
        results.ownWorlds.length ||
        results.favoriteWorlds.length ||
        results.ownGroups.length ||
        results.joinedGroups.length;

    const selectResult = useQuickSearchSelectResult({ onOpenChange, setQuery });
    function handleSearchCommand(event: KeyboardEvent<HTMLInputElement>) {
        const value = event.currentTarget.value;
        if (
            event.key !== 'Enter' ||
            event.nativeEvent.isComposing ||
            (value !== '/rgb-mode:on' && value !== '/rgb-mode:off')
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        setRgb(value === '/rgb-mode:on');
        setQuery('');
        onOpenChange(false);
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                onOpenChange(nextOpen);
                if (!nextOpen) {
                    setQuery('');
                }
            }}
        >
            <DialogContent
                showCloseButton={false}
                className="overflow-hidden p-0 sm:max-w-2xl"
            >
                <DialogHeader className="sr-only">
                    <DialogTitle>
                        {t('side_panel.search_placeholder')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('side_panel.search_placeholder')}
                    </DialogDescription>
                </DialogHeader>
                <Command shouldFilter={false} className="rounded-md! p-0!">
                    <CommandInput
                        autoFocus
                        value={query}
                        aria-label={t('side_panel.search_input_placeholder')}
                        placeholder={t('side_panel.search_input_placeholder')}
                        onKeyDownCapture={handleSearchCommand}
                        onValueChange={setQuery}
                    />
                    <CommandList className="max-h-[min(400px,50vh)]">
                        {normalizedQuery.length < USER_QUERY_MIN_LENGTH ? (
                            <CommandGroup
                                heading={t('side_panel.search_categories')}
                            >
                                <CommandItem
                                    value="hint-pages"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <CompassIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_pages')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_pages')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-friends"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <UsersIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_friends')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_all')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-avatars"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <PersonStandingIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_avatars')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_avatars')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-worlds"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <GlobeIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_worlds')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_worlds')}
                                    </CommandShortcut>
                                </CommandItem>
                                <CommandItem
                                    value="hint-groups"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <UsersIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_groups')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t('side_panel.search_scope_joined')}
                                    </CommandShortcut>
                                </CommandItem>
                            </CommandGroup>
                        ) : hasResults ? (
                            <>
                                <NavResultGroup
                                    title={t('side_panel.search_pages')}
                                    items={navCommands}
                                    onSelect={(item: QuickSearchNavCommand) => {
                                        onOpenChange(false);
                                        setQuery('');
                                        navigate(item.path);
                                    }}
                                />
                                <ResultGroup
                                    title={t('side_panel.friends')}
                                    items={results.friends}
                                    onSelect={selectResult}
                                />
                                <ResultGroup
                                    title={t('side_panel.search_own_avatars')}
                                    items={results.ownAvatars}
                                    onSelect={selectResult}
                                />
                                <ResultGroup
                                    title={t('side_panel.search_fav_avatars')}
                                    items={results.favoriteAvatars}
                                    onSelect={selectResult}
                                />
                                <ResultGroup
                                    title={t('side_panel.search_own_worlds')}
                                    items={results.ownWorlds}
                                    onSelect={selectResult}
                                />
                                <ResultGroup
                                    title={t('side_panel.search_fav_worlds')}
                                    items={results.favoriteWorlds}
                                    onSelect={selectResult}
                                />
                                <ResultGroup
                                    title={t('side_panel.search_own_groups')}
                                    items={results.ownGroups}
                                    onSelect={selectResult}
                                />
                                <ResultGroup
                                    title={t('side_panel.search_joined_groups')}
                                    items={results.joinedGroups}
                                    onSelect={selectResult}
                                />
                            </>
                        ) : (
                            <CommandEmpty>
                                {t('side_panel.search_no_results')}
                            </CommandEmpty>
                        )}
                        {catalog.status === 'error' && catalog.detail ? (
                            <div className="text-destructive px-2 pb-2 text-xs">
                                {catalog.detail}
                            </div>
                        ) : null}
                    </CommandList>
                </Command>
            </DialogContent>
        </Dialog>
    );
}
