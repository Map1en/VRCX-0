import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { nextHoverCardToken, useHoverCardStore } from '@/state/hoverCardStore';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';

import { UserHoverCardContent } from './UserHoverCardContent';
import { getHoverOpenSuppressionDeadline } from './userHoverCardSuppression';

const MODAL_OVERLAY_SELECTOR =
    '[data-slot="dialog-overlay"][data-state="open"],[data-slot="alert-dialog-overlay"][data-state="open"],[data-slot="sheet-overlay"][data-state="open"]';
const MODAL_CONTENT_SELECTOR =
    '[data-slot="dialog-content"],[data-slot="alert-dialog-content"],[data-slot="sheet-content"]';

export function UserHoverCard({
    userId,
    seed = null,
    openDelay = 500,
    closeDelay = 120,
    side = 'left',
    align = 'center',
    disabled = false,
    children
}: any) {
    const [open, setOpen] = useState(false);
    const [scrollClosed, setScrollClosed] = useState(false);
    const [token] = useState(nextHoverCardToken);
    const suppressUntilRef = useRef(0);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleScroll = (event: Event) => {
            const target = event.target as Element | null;
            if (target?.closest?.('[data-slot="hover-card-content"]')) {
                return;
            }
            setScrollClosed(true);
            setOpen(false);
        };
        window.addEventListener('scroll', handleScroll, true);
        return () => window.removeEventListener('scroll', handleScroll, true);
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        useHoverCardStore.getState().claim(token);
        const unsubscribe = useHoverCardStore.subscribe((state) => {
            if (state.activeToken !== token) {
                setOpen(false);
            }
        });
        return () => {
            unsubscribe();
            useHoverCardStore.getState().release(token);
        };
    }, [open, token]);

    if (disabled || !userId) {
        return children;
    }
    return (
        <HoverCard
            open={open}
            onOpenChange={(next) => {
                if (next && Date.now() < suppressUntilRef.current) {
                    return;
                }
                if (next) {
                    setScrollClosed(false);
                }
                setOpen(next);
            }}
            openDelay={openDelay}
            closeDelay={closeDelay}
        >
            <HoverCardTrigger
                asChild
                onPointerOverCapture={(event) => {
                    if (
                        !event.currentTarget.closest(MODAL_CONTENT_SELECTOR) &&
                        document.querySelector(MODAL_OVERLAY_SELECTOR)
                    ) {
                        suppressUntilRef.current =
                            getHoverOpenSuppressionDeadline(
                                Date.now(),
                                openDelay
                            );
                    }
                }}
                onPointerDownCapture={() => {
                    suppressUntilRef.current = getHoverOpenSuppressionDeadline(
                        Date.now(),
                        openDelay
                    );
                    setOpen(false);
                }}
            >
                {children}
            </HoverCardTrigger>
            <HoverCardContent
                className={cn(
                    'w-72 overflow-hidden p-0',
                    scrollClosed && 'data-[state=closed]:!animate-none'
                )}
                side={side}
                align={align}
                sideOffset={8}
            >
                <UserHoverCardContent userId={userId} seed={seed} />
            </HoverCardContent>
        </HoverCard>
    );
}
