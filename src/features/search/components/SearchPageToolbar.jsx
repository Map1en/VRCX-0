import { Trash2Icon, XIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

export function SearchPageToolbar({
    t,
    searchText,
    searchPlaceholder,
    onSearchTextChange,
    onSearch,
    onClearSearch
}) {
    return (
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
                        className={cn('min-w-0 flex-1', searchText && 'pr-8')}
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
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2"
                            aria-label={'Clear input'}
                            onClick={() => onSearchTextChange('')}
                        >
                            <XIcon data-icon="inline-start" />
                        </Button>
                    ) : null}
                </div>
                <Button
                    type="button"
                    className="ml-2"
                    size="icon"
                    variant="ghost"
                    title={t('view.search.clear_results_tooltip')}
                    aria-label={'Clear Search Results'}
                    onClick={onClearSearch}
                >
                    <Trash2Icon data-icon="inline-start" />
                    <span className="sr-only">
                        {t('view.search.clear_results_tooltip')}
                    </span>
                </Button>
            </div>
        </div>
    );
}
