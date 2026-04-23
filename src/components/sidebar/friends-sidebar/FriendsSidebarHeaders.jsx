import { ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';

import { StaticSidebarLocation } from './FriendsSidebarLocation.jsx';

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
            return SIDEBAR_MESSAGE_ROW_SIZE;
        case 'footer':
            return SIDEBAR_FOOTER_ROW_SIZE;
        default:
            return FRIEND_ROW_SIZE;
    }
}

export function FriendSectionHeader({ id, title, count, open, onToggle }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start px-0 py-1.5 pt-4 text-left text-xs font-normal"
            onClick={() => onToggle(id)}
        >
            <ChevronDownIcon
                data-icon="inline-start"
                className={cn('transition-transform', !open && '-rotate-90')}
            />
            <span className="ml-1.5">
                {title}
                {count !== null && count !== undefined
                    ? ` \u2014 ${count}`
                    : ''}
            </span>
        </Button>
    );
}

export function InstanceHeaderRow({
    location,
    count,
    metadata = null,
    t,
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
                t={t}
                showInstanceIdInLocation={showInstanceIdInLocation}
                ageGatedInstancesVisible={ageGatedInstancesVisible}
            />
            <span className="ml-1.5 shrink-0">{`(${count})`}</span>
        </div>
    );
}
