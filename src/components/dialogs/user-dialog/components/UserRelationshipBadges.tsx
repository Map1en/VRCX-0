import {
    BanIcon,
    EyeOffIcon,
    HandIcon,
    MessageSquareXIcon,
    SendIcon,
    UserCheckIcon,
    UserPlusIcon,
    VolumeXIcon,
    type LucideIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/ui/shadcn/badge';

import type { UserRelationshipBadgeKey } from '../userRelationshipBadges';

const BADGE_META: Record<
    UserRelationshipBadgeKey,
    {
        icon: LucideIcon;
        labelKey: string;
        variant: 'secondary' | 'outline' | 'destructive';
    }
> = {
    friend: {
        icon: UserCheckIcon,
        labelKey: 'dialog.user.relationship.friend',
        variant: 'secondary'
    },
    'request-received': {
        icon: UserPlusIcon,
        labelKey: 'dialog.user.relationship.request_received',
        variant: 'outline'
    },
    'request-sent': {
        icon: SendIcon,
        labelKey: 'dialog.user.relationship.request_sent',
        variant: 'outline'
    },
    blocked: {
        icon: BanIcon,
        labelKey: 'dialog.user.error.blocked',
        variant: 'destructive'
    },
    muted: {
        icon: VolumeXIcon,
        labelKey: 'dialog.user.label.muted',
        variant: 'destructive'
    },
    'avatar-hidden': {
        icon: EyeOffIcon,
        labelKey: 'dialog.user.relationship.avatar_hidden',
        variant: 'outline'
    },
    'interaction-off': {
        icon: HandIcon,
        labelKey: 'dialog.user.relationship.interaction_off',
        variant: 'outline'
    },
    'chatbox-muted': {
        icon: MessageSquareXIcon,
        labelKey: 'dialog.user.relationship.chatbox_muted',
        variant: 'outline'
    }
};

export function UserRelationshipBadges({
    badges
}: {
    badges: readonly UserRelationshipBadgeKey[];
}) {
    const { t } = useTranslation();
    return badges.map((key) => {
        const { icon: Icon, labelKey, variant } = BADGE_META[key];
        return (
            <Badge key={key} variant={variant} data-relationship-badge={key}>
                <Icon data-icon="inline-start" aria-hidden="true" />
                {t(labelKey)}
            </Badge>
        );
    });
}
