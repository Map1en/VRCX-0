import { SearchIcon, XIcon } from 'lucide-react';
import { memo, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { FriendRecord } from '@/domain/friends/types';
import { userImage } from '@/services/entityMediaService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxChip,
    ComboboxChips,
    ComboboxChipsInput,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxItem,
    ComboboxList,
    ComboboxValue,
    useComboboxAnchor
} from '@/ui/shadcn/combobox';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Kbd } from '@/ui/shadcn/kbd';
import { Spinner } from '@/ui/shadcn/spinner';

const MAX_FRIEND_CANDIDATES = 50;

function FriendAvatar({
    friend,
    name
}: {
    friend?: FriendRecord;
    name: string;
}) {
    const imageUrl = friend ? userImage(friend, true, '64') : '';

    return (
        <Avatar size="sm">
            {imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
            <AvatarFallback className="text-[10px]">
                {name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
        </Avatar>
    );
}

type FeedSearchBoxProps = {
    dateFilter: ReactNode;
    isSearching: boolean;
    onClearSearch(): void;
    onCommitSearch(): void;
    onScopeChange(userIds: readonly string[]): void;
    onSearchDraftChange(value: string): void;
    scopedUserIds: string[];
    searchDraft: string;
};

export const FeedSearchBox = memo(function FeedSearchBox({
    dateFilter,
    isSearching,
    onClearSearch,
    onCommitSearch,
    onScopeChange,
    onSearchDraftChange,
    scopedUserIds,
    searchDraft
}: FeedSearchBoxProps) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );

    const resolveName = (userId: string) =>
        friendsById[userId]?.displayName || userId;

    const trimmedDraft = searchDraft.trim();
    const candidateIds = useMemo(() => {
        const query = trimmedDraft.toLowerCase();
        const matchesQuery = (userId: string) => {
            const displayName = friendsById[userId]?.displayName;
            if (!displayName) {
                return false;
            }
            return !query || displayName.toLowerCase().includes(query);
        };
        const selected = scopedUserIds.filter(matchesQuery);
        const matches: string[] = [];
        for (const userId of orderedFriendIds) {
            if (matches.length >= MAX_FRIEND_CANDIDATES) {
                break;
            }
            if (scopedUserIds.includes(userId) || !matchesQuery(userId)) {
                continue;
            }
            matches.push(userId);
        }
        return [...selected, ...matches];
    }, [friendsById, orderedFriendIds, scopedUserIds, trimmedDraft]);

    const anchorRef = useComboboxAnchor();

    return (
        <InputGroup ref={anchorRef} className="h-auto min-h-8 flex-1">
            <Combobox
                multiple
                filter={null}
                items={candidateIds}
                value={scopedUserIds}
                inputValue={searchDraft}
                itemToStringLabel={resolveName}
                onValueChange={onScopeChange}
                onInputValueChange={(value, details) => {
                    if (details.reason === 'input-change') {
                        onSearchDraftChange(value);
                        return;
                    }
                    if (details.reason === 'item-press') {
                        onClearSearch();
                    }
                }}
            >
                <ComboboxChips
                    className="min-h-0 min-w-0 flex-1 rounded-none border-0 focus-within:ring-0 dark:bg-transparent"
                    aria-label={t('view.feed.search_scope.aria_label')}
                    aria-busy={isSearching}
                >
                    {isSearching ? (
                        <Spinner className="text-muted-foreground pointer-events-none size-4 shrink-0" />
                    ) : (
                        <SearchIcon className="text-muted-foreground pointer-events-none size-4 shrink-0" />
                    )}
                    <ComboboxValue>
                        {(userIds: string[]) => (
                            <>
                                {userIds.map((userId) => (
                                    <ComboboxChip key={userId}>
                                        <span className="max-w-28 truncate">
                                            {resolveName(userId)}
                                        </span>
                                    </ComboboxChip>
                                ))}
                                <ComboboxChipsInput
                                    render={
                                        <InputGroupInput className="h-5 px-0 py-0" />
                                    }
                                    data-slot="input-group-control"
                                    aria-label={t(
                                        'view.feed.search_scope.aria_label'
                                    )}
                                    placeholder={t(
                                        'view.feed.search_placeholder'
                                    )}
                                    onKeyDown={(event) => {
                                        if (
                                            event.key === 'Enter' &&
                                            !event.currentTarget.hasAttribute(
                                                'aria-activedescendant'
                                            )
                                        ) {
                                            onCommitSearch();
                                        }
                                    }}
                                />
                                {userIds.length || searchDraft ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={t('common.actions.clear')}
                                        className="ml-auto shrink-0 opacity-50 hover:opacity-100"
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onClick={() => {
                                            onScopeChange([]);
                                            onClearSearch();
                                        }}
                                    >
                                        <XIcon data-icon="icon" />
                                    </Button>
                                ) : null}
                            </>
                        )}
                    </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent anchor={anchorRef}>
                    <ComboboxEmpty>
                        {t('view.feed.search_scope.no_friends')}
                    </ComboboxEmpty>
                    <ComboboxList>
                        {(userId: string) => (
                            <ComboboxItem
                                key={userId}
                                value={userId}
                                className="gap-2.5 py-2 pl-2"
                            >
                                <FriendAvatar
                                    friend={friendsById[userId]}
                                    name={resolveName(userId)}
                                />
                                <span className="truncate">
                                    {resolveName(userId)}
                                </span>
                            </ComboboxItem>
                        )}
                    </ComboboxList>
                    {trimmedDraft ? (
                        <div className="text-muted-foreground border-border/60 flex items-center gap-2 border-t px-2 py-1.5 text-xs">
                            <SearchIcon className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                                {t('view.feed.search_scope.search_all', {
                                    query: trimmedDraft
                                })}
                            </span>
                            <Kbd>⏎</Kbd>
                        </div>
                    ) : null}
                </ComboboxContent>
            </Combobox>
            <InputGroupAddon align="inline-end" className="shrink-0 gap-1 py-0">
                {dateFilter}
            </InputGroupAddon>
        </InputGroup>
    );
});
