import { BellIcon, XIcon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/state/notificationStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet';

export function NotificationHost() {
    const { t } = useTranslation();

    const items = useNotificationStore((state) => state.items);
    const isPanelOpen = useNotificationStore((state) => state.isPanelOpen);
    const setPanelOpen = useNotificationStore((state) => state.setPanelOpen);
    const dismissNotification = useNotificationStore(
        (state) => state.dismissNotification
    );
    const markAllRead = useNotificationStore((state) => state.markAllRead);
    const unreadCount = items.filter((item) => !item.read).length;

    return (
        <Sheet open={isPanelOpen} onOpenChange={setPanelOpen}>
            <SheetContent className="w-full sm:max-w-lg">
                <SheetHeader className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                        <SheetTitle className="flex items-center gap-2">
                            <BellIcon className="size-4" />
                            {t('dialog.tools.generated.notifications')}
                        </SheetTitle>
                        <Badge
                            variant={unreadCount > 0 ? 'default' : 'outline'}
                        >
                            {unreadCount} {t('dialog.tools.generated.unread')}
                        </Badge>
                    </div>
                    <SheetDescription>
                        {t('dialog.tools.generated.backend_events_and_system_messages_land_here')}
                    </SheetDescription>
                </SheetHeader>
                <div className="mt-6 flex items-center justify-between gap-3">
                    <div className="text-muted-foreground text-xs">
                        {t('dialog.tools.generated.notifications_are_surfaced_from_the_top_level_status_bar')}
                    </div>
                    <Button size="sm" variant="outline" onClick={markAllRead}>
                        {t('dialog.tools.generated.mark_all_read')}
                    </Button>
                </div>
                <Separator className="my-4" />
                <div className="mt-4 flex flex-col gap-3">
                    {items.length > 0 ? (
                        items.map((item) => (
                            <div
                                key={item.id}
                                className="rounded-md border p-3 shadow-sm"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex flex-col gap-1">
                                        <div className="text-sm font-medium">
                                            {item.title}
                                        </div>
                                        <div className="text-muted-foreground text-xs">
                                            {item.message}
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={"Dismiss notification"}
                                        onClick={() =>
                                            dismissNotification(item.id)
                                        }
                                    >
                                        <XIcon data-icon="inline-start" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                            {t('dialog.tools.generated.no_notifications_yet')}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
