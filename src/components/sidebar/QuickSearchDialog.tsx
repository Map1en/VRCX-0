import {
    CompassIcon,
    GlobeIcon,
    LinkIcon,
    PersonStandingIcon,
    UsersIcon
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { cn } from '@/lib/utils';
import { directAccessParse } from '@/services/directAccessService';
import { triggerToolByKey } from '@/services/toolActionService';
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
    normalizeSearchValue,
    USER_QUERY_MIN_LENGTH
} from './quick-search/quickSearchResultModel';
import { useDirectAccessCandidate } from './quick-search/useDirectAccessCandidate';
import { useQuickSearchHistory } from './quick-search/useQuickSearchHistory';
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
    const directAccessInput = normalizeSearchValue(query);
    const canDirectAccess = useDirectAccessCandidate(directAccessInput);
    const showSearchOverview = normalizedQuery.length < USER_QUERY_MIN_LENGTH;
    const navCommands = useNavCommands(normalizedQuery);
    const results = useQuickSearchResults({
        currentEndpoint,
        currentUserId,
        normalizedQuery,
        open
    });
    const history = useQuickSearchHistory({
        currentEndpoint,
        currentUserId,
        open
    });

    const hasResults =
        canDirectAccess ||
        navCommands.length ||
        results.friends.length ||
        results.ownAvatars.length ||
        results.favoriteAvatars.length ||
        results.ownWorlds.length ||
        results.favoriteWorlds.length ||
        results.ownGroups.length ||
        results.joinedGroups.length;

    const selectResult = useQuickSearchSelectResult({
        onOpenChange,
        setQuery,
        onResultOpened: history.remember
    });
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

    function selectDirectAccess() {
        const input = directAccessInput;
        onOpenChange(false);
        setQuery('');
        directAccessParse(input).catch((error: unknown) => {
            console.warn('Direct access failed:', error);
        });
    }

    async function selectNavCommand(item: QuickSearchNavCommand) {
        onOpenChange(false);
        setQuery('');
        if (item.target.type === 'path') {
            navigate(item.target.path);
            return;
        }
        await triggerToolByKey(item.target.toolKey, { navigate, t });
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
                    <CommandList
                        className={cn(
                            'max-h-[min(400px,50vh)]',
                            showSearchOverview && 'max-h-none'
                        )}
                    >
                        {showSearchOverview ? (
                            <ResultGroup
                                title={t('side_panel.search_recent')}
                                items={history.items}
                                onSelect={selectResult}
                            />
                        ) : null}
                        {showSearchOverview ? (
                            <CommandGroup
                                heading={t('prompt.direct_access_omni.header')}
                            >
                                <CommandItem
                                    value="hint-direct-access"
                                    disabled
                                    className="gap-3 opacity-70"
                                >
                                    <LinkIcon />
                                    <span className="min-w-0 flex-1 truncate">
                                        {t('side_panel.search_direct_access')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t(
                                            'side_panel.search_scope_direct_access'
                                        )}
                                    </CommandShortcut>
                                </CommandItem>
                            </CommandGroup>
                        ) : null}
                        {showSearchOverview ? (
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
                                        {t('side_panel.search_pages_and_tools')}
                                    </span>
                                    <CommandShortcut className="max-w-[45%] truncate tracking-normal">
                                        {t(
                                            'side_panel.search_scope_pages_and_tools'
                                        )}
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
                                {canDirectAccess ? (
                                    <CommandGroup
                                        heading={t(
                                            'prompt.direct_access_omni.header'
                                        )}
                                    >
                                        <CommandItem
                                            value={`direct-access:${directAccessInput}`}
                                            className="gap-3"
                                            onSelect={selectDirectAccess}
                                        >
                                            <LinkIcon className="size-4 shrink-0" />
                                            <div className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate">
                                                    {t(
                                                        'side_panel.search_open_direct'
                                                    )}
                                                </span>
                                                <span className="text-muted-foreground truncate text-xs">
                                                    {directAccessInput}
                                                </span>
                                            </div>
                                        </CommandItem>
                                    </CommandGroup>
                                ) : null}
                                <NavResultGroup
                                    title={t(
                                        'side_panel.search_pages_and_tools'
                                    )}
                                    items={navCommands}
                                    onSelect={(item: QuickSearchNavCommand) => {
                                        void selectNavCommand(item);
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
                        ) : results.status === 'running' ? null : (
                            <CommandEmpty>
                                {t('side_panel.search_no_results')}
                            </CommandEmpty>
                        )}
                        {results.status === 'error' && results.detail ? (
                            <div className="text-destructive px-2 pb-2 text-xs">
                                {results.detail}
                            </div>
                        ) : null}
                    </CommandList>
                </Command>
            </DialogContent>
        </Dialog>
    );
}
