import { GlobeIcon, SearchIcon, XIcon } from 'lucide-react';
import { memo, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isImeComposing } from '@/components/keyboard/keyboardShortcutGuards';
import type { ScreenshotFacet } from '@/platform/tauri/bindings';
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

const PEOPLE_CANDIDATES = 30;
const WORLD_CANDIDATES = 20;
const USER_KEY = 'user:';
const WORLD_KEY = 'world:';

function splitKeys(keys: readonly string[]) {
    return {
        people: keys
            .filter((key) => key.startsWith(USER_KEY))
            .map((key) => key.slice(USER_KEY.length)),
        worlds: keys
            .filter((key) => key.startsWith(WORLD_KEY))
            .map((key) => key.slice(WORLD_KEY.length))
    };
}

type ScreenshotSearchBoxProps = {
    people: string[];
    worlds: string[];
    peopleFacets: ScreenshotFacet[];
    worldFacets: ScreenshotFacet[];
    draft: string;
    isSearching: boolean;
    dateFilter: ReactNode;
    onDraftChange(value: string): void;
    onScopeChange(people: string[], worlds: string[]): void;
    onCommitText(): void;
    onClear(): void;
};

export const ScreenshotSearchBox = memo(function ScreenshotSearchBox({
    people,
    worlds,
    peopleFacets,
    worldFacets,
    draft,
    isSearching,
    dateFilter,
    onDraftChange,
    onScopeChange,
    onCommitText,
    onClear
}: ScreenshotSearchBoxProps) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const anchorRef = useComboboxAnchor();
    const facetsByKey = useMemo(
        () =>
            new Map([
                ...peopleFacets.map(
                    (facet) => [USER_KEY + facet.id, facet] as const
                ),
                ...worldFacets.map(
                    (facet) => [WORLD_KEY + facet.id, facet] as const
                )
            ]),
        [peopleFacets, worldFacets]
    );
    const selectedKeys = useMemo(
        () => [
            ...people.map((id) => USER_KEY + id),
            ...worlds.map((id) => WORLD_KEY + id)
        ],
        [people, worlds]
    );
    const query = draft.trim().toLowerCase();
    const candidateKeys = useMemo(() => {
        const matches = (facet: ScreenshotFacet) =>
            !query || facet.name.toLowerCase().includes(query);
        const pick = (
            facets: ScreenshotFacet[],
            prefix: string,
            limit: number
        ) =>
            facets
                .filter(
                    (facet) =>
                        matches(facet) &&
                        !selectedKeys.includes(prefix + facet.id)
                )
                .slice(0, limit)
                .map((facet) => prefix + facet.id);
        return [
            ...selectedKeys,
            ...pick(peopleFacets, USER_KEY, PEOPLE_CANDIDATES),
            ...pick(worldFacets, WORLD_KEY, WORLD_CANDIDATES)
        ];
    }, [peopleFacets, query, selectedKeys, worldFacets]);

    const labelOf = (key: string) => {
        const facet = facetsByKey.get(key);
        if (facet?.name) {
            return facet.name;
        }
        const id = key.slice(key.indexOf(':') + 1);
        return friendsById[id]?.displayName || id;
    };

    return (
        <InputGroup
            ref={anchorRef}
            className="h-auto min-h-8 w-48 shrink-0 sm:w-80"
        >
            <Combobox
                multiple
                filter={null}
                items={candidateKeys}
                value={selectedKeys}
                inputValue={draft}
                itemToStringLabel={labelOf}
                onValueChange={(keys: string[]) => {
                    const next = splitKeys(keys);
                    onScopeChange(next.people, next.worlds);
                }}
                onInputValueChange={(value, details) => {
                    if (details.reason === 'input-change') {
                        onDraftChange(value);
                        return;
                    }
                    if (
                        details.reason === 'input-clear' &&
                        details.isItemPress
                    ) {
                        onDraftChange('');
                    }
                }}
            >
                <ComboboxChips
                    className="min-h-0 min-w-0 flex-1 rounded-none border-0 focus-within:ring-0 dark:bg-transparent"
                    aria-label={t('dialog.screenshot_metadata.search_label')}
                    aria-busy={isSearching}
                >
                    {isSearching ? (
                        <Spinner className="text-muted-foreground pointer-events-none size-4 shrink-0" />
                    ) : (
                        <SearchIcon className="text-muted-foreground pointer-events-none size-4 shrink-0" />
                    )}
                    <ComboboxValue>
                        {(keys: string[]) => (
                            <>
                                {keys.map((key) => (
                                    <ComboboxChip key={key}>
                                        {key.startsWith(WORLD_KEY) ? (
                                            <GlobeIcon className="size-3 shrink-0" />
                                        ) : null}
                                        <span className="max-w-28 truncate">
                                            {labelOf(key)}
                                        </span>
                                    </ComboboxChip>
                                ))}
                                <ComboboxChipsInput
                                    render={
                                        <InputGroupInput className="h-5 px-0 py-0" />
                                    }
                                    data-slot="input-group-control"
                                    aria-label={t(
                                        'dialog.screenshot_metadata.search_label'
                                    )}
                                    placeholder={t(
                                        'dialog.screenshot_metadata.search_placeholder'
                                    )}
                                    onKeyDown={(event) => {
                                        if (
                                            event.key === 'Enter' &&
                                            !isImeComposing(
                                                event.nativeEvent
                                            ) &&
                                            !event.currentTarget.hasAttribute(
                                                'aria-activedescendant'
                                            )
                                        ) {
                                            onCommitText();
                                        }
                                    }}
                                />
                                {keys.length || draft ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={t('common.actions.clear')}
                                        className="ml-auto shrink-0 opacity-50 hover:opacity-100"
                                        onMouseDown={(event) =>
                                            event.preventDefault()
                                        }
                                        onClick={onClear}
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
                        {t('dialog.screenshot_metadata.no_candidates')}
                    </ComboboxEmpty>
                    <ComboboxList>
                        {(key: string) => {
                            const facet = facetsByKey.get(key);
                            const isWorld = key.startsWith(WORLD_KEY);
                            const friend = isWorld
                                ? undefined
                                : friendsById[key.slice(USER_KEY.length)];
                            const imageUrl = friend
                                ? userImage(friend, 64)
                                : '';
                            return (
                                <ComboboxItem
                                    key={key}
                                    value={key}
                                    className="gap-2.5 py-2 pl-2"
                                >
                                    {isWorld ? (
                                        <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
                                            <GlobeIcon className="size-3.5" />
                                        </span>
                                    ) : (
                                        <Avatar size="sm">
                                            {imageUrl ? (
                                                <AvatarImage
                                                    src={imageUrl}
                                                    alt=""
                                                />
                                            ) : null}
                                            <AvatarFallback className="text-[10px]">
                                                {labelOf(key)
                                                    .slice(0, 1)
                                                    .toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                    )}
                                    <span className="min-w-0 flex-1 truncate">
                                        {labelOf(key)}
                                    </span>
                                    {facet ? (
                                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                                            {t(
                                                'dialog.screenshot_metadata.image_count',
                                                { count: facet.count }
                                            )}
                                        </span>
                                    ) : null}
                                </ComboboxItem>
                            );
                        }}
                    </ComboboxList>
                    {query ? (
                        <div className="text-muted-foreground border-border/60 flex items-center gap-2 border-t px-2 py-1.5 text-xs">
                            <SearchIcon className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                                {t('dialog.screenshot_metadata.search_text', {
                                    query: draft.trim()
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
