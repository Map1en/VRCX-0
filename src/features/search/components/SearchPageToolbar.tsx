import { SearchIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { PageToolbar, PageToolbarRow } from '@/components/layout/PageScaffold';
import { Button } from '@/ui/shadcn/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function SearchPageToolbar({
    activeTab,
    searchText,
    onSearchTextChange,
    onSearch,
    onClearSearch
}: any) {
    const { t } = useTranslation();
    const searchPlaceholder =
        activeTab === 'avatar'
            ? t('view.search.avatar.search_placeholder_avatar')
            : t('view.search.search_placeholder');

    return (
        <PageToolbar>
            <PageToolbarRow>
                <TabsList className="h-full! shrink-0 flex-wrap">
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

                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <InputGroup className="h-9 min-w-0 flex-1">
                        <InputGroupAddon>
                            <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                            value={searchText}
                            placeholder={searchPlaceholder}
                            onChange={(event) =>
                                onSearchTextChange(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    onSearch();
                                }
                            }}
                        />
                        {searchText ? (
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    type="button"
                                    size="icon-xs"
                                    aria-label={t('common.actions.clear')}
                                    onClick={() => onSearchTextChange('')}
                                >
                                    <XIcon data-icon="icon" />
                                </InputGroupButton>
                            </InputGroupAddon>
                        ) : (
                            <InputGroupAddon
                                align="inline-end"
                                className="pointer-events-none"
                            >
                                <KeyboardShortcut keys="Enter" />
                            </InputGroupAddon>
                        )}
                    </InputGroup>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    size="icon-lg"
                                    variant="ghost"
                                    aria-label={t(
                                        'view.search.clear_results_tooltip'
                                    )}
                                    onClick={onClearSearch}
                                >
                                    <Trash2Icon data-icon="inline-start" />
                                    <span className="sr-only">
                                        {t('view.search.clear_results_tooltip')}
                                    </span>
                                </Button>
                            }
                        />
                        <TooltipContent>
                            {t('view.search.clear_results_tooltip')}
                        </TooltipContent>
                    </Tooltip>
                </div>
            </PageToolbarRow>
        </PageToolbar>
    );
}
