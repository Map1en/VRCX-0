// @ts-nocheck
import { ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import { Collapsible, CollapsibleTrigger } from '@/ui/shadcn/collapsible';

import { StaticSidebarLocation } from './FriendsSidebarLocation';

const FRIEND_ROW_SIZE = 49;
const SECTION_HEADER_ROW_SIZE = 38;
const INSTANCE_HEADER_ROW_SIZE = 26;
const FAVORITE_GROUP_HEADER_ROW_SIZE = 26;
const SIDEBAR_MESSAGE_ROW_SIZE = 64;
const SIDEBAR_FOOTER_ROW_SIZE = 16;

export function estimateFriendSidebarRowSize(row) {
    switch (row?.type) {
        case 'section':
            return SECTION_HEADER_ROW_SIZE;
        case 'instance-header':
            return INSTANCE_HEADER_ROW_SIZE;
        case 'favorite-group-header':
            return FAVORITE_GROUP_HEADER_ROW_SIZE;
        case 'message':
        case 'skeleton':
            return SIDEBAR_MESSAGE_ROW_SIZE;
        case 'footer':
            return SIDEBAR_FOOTER_ROW_SIZE;
        default:
            return FRIEND_ROW_SIZE;
    }
}

export function FriendSectionHeader({ id, title, count, open, onToggle }) {
    const isOpen = Boolean(open);

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={(nextOpen) => {
                if (nextOpen !== isOpen) {
                    onToggle(id);
                }
            }}
        >
            <CollapsibleTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground dark:aria-expanded:hover:bg-muted/50 w-full justify-between aria-expanded:bg-transparent aria-expanded:text-inherit dark:aria-expanded:bg-transparent"
                >
                    <span className="min-w-0 flex-1 truncate text-left">
                        {title}
                        {count !== null && count !== undefined
                            ? ` \u2014 ${count}`
                            : ''}
                    </span>
                    <ChevronDownIcon
                        data-icon="inline-end"
                        className={cn(
                            'transition-transform',
                            !isOpen && '-rotate-90'
                        )}
                    />
                </Button>
            </CollapsibleTrigger>
        </Collapsible>
    );
}

export function InstanceHeaderRow({
    location,
    count,
    metadata = null,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false
}) {
    return (
        <div className="mb-1 flex min-w-0 items-center px-1.5 text-xs">
            <StaticSidebarLocation
                className="min-w-0 flex-1 text-xs"
                location={location}
                link
                showGroupLink
                metadata={metadata}
                showInstanceIdInLocation={showInstanceIdInLocation}
                ageGatedInstancesVisible={ageGatedInstancesVisible}
            />
            <span className="ml-1.5 shrink-0">{`(${count})`}</span>
        </div>
    );
}
