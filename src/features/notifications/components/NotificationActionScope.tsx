import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { IntentTooltip } from '@/ui/hint-tooltip';

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
        <IntentTooltip content={getNotificationActionScopeLabel(scope, t)}>
            {children}
        </IntentTooltip>
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
