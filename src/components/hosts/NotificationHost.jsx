import { BellIcon, XIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button.jsx';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Separator } from '@/ui/shadcn/separator.jsx';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet.jsx';

import { useNotificationStore } from '@/state/notificationStore.js';

export function NotificationHost() {
    const items = useNotificationStore((state) => state.items);
    const isPanelOpen = useNotificationStore((state) => state.isPanelOpen);
    const setPanelOpen = useNotificationStore((state) => state.setPanelOpen);
    const dismissNotification = useNotificationStore((state) => state.dismissNotification);
    const markAllRead = useNotificationStore((state) => state.markAllRead);
    const unreadCount = items.filter((item) => !item.read).length;

    return (
        <Sheet open={isPanelOpen} onOpenChange={setPanelOpen}>
            <SheetContent className="w-full sm:max-w-lg">
                <SheetHeader className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <SheetTitle className="flex items-center gap-2">
                            <BellIcon className="size-4" />
                            Notifications
                        </SheetTitle>
                        <Badge variant={unreadCount > 0 ? 'default' : 'outline'}>
                            {unreadCount} unread
                        </Badge>
                    </div>
                    <SheetDescription>
                        Backend events and system messages land here.
                    </SheetDescription>
                </SheetHeader>
                <div className="mt-6 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                        Notifications are surfaced from the top-level status bar.
                    </div>
                    <Button size="sm" variant="outline" onClick={markAllRead}>
                        Mark all read
                    </Button>
                </div>
                <Separator className="my-4" />
                <div className="mt-4 flex flex-col gap-3">
                    {items.length > 0 ? (
                        items.map((item) => (
                            <div
                                key={item.id}
                                className="rounded-md border p-3 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium">{item.title}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {item.message}
                                        </div>
                                    </div>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-7"
                                        onClick={() => dismissNotification(item.id)}>
                                        <XIcon className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                            No notifications yet.
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
