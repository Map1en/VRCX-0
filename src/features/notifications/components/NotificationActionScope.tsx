import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    getNotificationActionScopeLabel,
    type NotificationActionScope
} from '../notificationRowActions';

export function NotificationActionScopeTooltip({
    scope,
    children
}: {
    scope: NotificationActionScope;
    children: ReactElement;
}) {
    const { t } = useTranslation();
    return (
        <Tooltip>
            <TooltipTrigger render={children} />
            <TooltipContent>
                {getNotificationActionScopeLabel(scope, t)}
            </TooltipContent>
        </Tooltip>
    );
}

export function NotificationActionMenuText({
    label,
    scope
}: {
    label: string;
    scope: NotificationActionScope;
}) {
    const { t } = useTranslation();
    return (
        <span className="flex min-w-0 flex-col">
            <span>{label}</span>
            <span className="text-muted-foreground text-xs">
                {getNotificationActionScopeLabel(scope, t)}
            </span>
        </span>
    );
}
