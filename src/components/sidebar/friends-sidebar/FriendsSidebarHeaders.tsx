import { MapPinIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LocationMetadata } from '@/components/location/useLocationMetadata';
import { Badge } from '@/ui/shadcn/badge';

import { StaticSidebarLocation } from './FriendsSidebarLocation';
import type { SidebarVirtualRow } from './friendsSidebarVirtualRowBuilder';

const FRIEND_ROW_SIZE = 49;
const SECTION_HEADER_ROW_SIZE = 38;
const SECTION_HEADER_TOP_GAP = 16;
const INSTANCE_HEADER_ROW_SIZE = 26;
const FAVORITE_GROUP_HEADER_ROW_SIZE = 26;
const SIDEBAR_MESSAGE_ROW_SIZE = 64;
const SIDEBAR_FOOTER_ROW_SIZE = 16;

export function estimateFriendSidebarRowSize(
    row: SidebarVirtualRow,
    index: number
) {
    switch (row?.type) {
        case 'section':
            return index === 0
                ? SECTION_HEADER_ROW_SIZE
                : SECTION_HEADER_ROW_SIZE + SECTION_HEADER_TOP_GAP;
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

export function InstanceHeaderRow({
    location,
    count,
    isCurrentInstance = false,
    metadata = null,
    showInstanceIdInLocation = false,
    ageGatedInstancesVisible = false
}: {
    location?: string | null;
    count?: number;
    isCurrentInstance?: boolean;
    metadata?: LocationMetadata | null;
    showInstanceIdInLocation?: boolean;
    ageGatedInstancesVisible?: boolean;
}) {
    const { t } = useTranslation();

    return (
        <div className="text-muted-foreground mb-1 flex min-w-0 items-center px-1.5 text-xs">
            <StaticSidebarLocation
                className="min-w-0 flex-1 text-xs"
                location={location}
                link
                actionMenu
                showGroupLink
                metadata={metadata}
                showInstanceIdInLocation={showInstanceIdInLocation}
                ageGatedInstancesVisible={ageGatedInstancesVisible}
            />
            {isCurrentInstance ? (
                <MapPinIcon
                    className="ml-1 size-3 shrink-0"
                    aria-label={t('side_panel.you_are_here')}
                />
            ) : null}
            <Badge variant="outline" className="ml-1.5">
                {count}
            </Badge>
        </div>
    );
}
