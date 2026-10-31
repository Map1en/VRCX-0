import {
    useEffect,
    useRef,
    useState,
    type ComponentProps,
    type PointerEvent,
    type ReactElement
} from 'react';

import type { SidebarFriendRecord } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { cn } from '@/lib/utils';
import { nextHoverCardToken, useHoverCardStore } from '@/state/hoverCardStore';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';

import { UserHoverCardContent } from './UserHoverCardContent';
import { getHoverOpenSuppressionDeadline } from './userHoverCardSuppression';
import { prefetchUserHoverCardProfile } from './useUserHoverCardData';

const MODAL_OVERLAY_SELECTOR =
    '[data-slot="dialog-overlay"][data-open],[data-slot="alert-dialog-overlay"][data-open],[data-slot="sheet-overlay"][data-open]';
const MODAL_CONTENT_SELECTOR =
    '[data-slot="dialog-content"],[data-slot="alert-dialog-content"],[data-slot="sheet-content"]';

type UserHoverCardProps = {
    userId?: string;
    seed?: SidebarFriendRecord | Record<string, unknown> | null;
    openDelay?: number;
    closeDelay?: number;
    side?: ComponentProps<typeof HoverCardContent>['side'];
    align?: ComponentProps<typeof HoverCardContent>['align'];
    disabled?: boolean;
    children: ReactElement;
};

export function UserHoverCard({
    userId,
    seed = null,
    openDelay = 500,
    closeDelay = 120,
    side = 'left',
    align = 'center',
    disabled = false,
    children
}: UserHoverCardProps) {
    const [open, setOpen] = useState(false);
    const [scrollClosed, setScrollClosed] = useState(false);
    const [token] = useState(nextHoverCardToken);
    const suppressUntilRef = useRef(0);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const dismissedRef = useRef(false);
    const openTimerRef = useRef(0);
    const prefetchTimerRef = useRef(0);

    function clearIntentTimers() {
        window.clearTimeout(openTimerRef.current);
        window.clearTimeout(prefetchTimerRef.current);
    }

    useEffect(() => clearIntentTimers, []);

    function handleIntentPointerMove(event: PointerEvent<HTMLElement>) {
        if (event.pointerType === 'touch' || dismissedRef.current) {
            return;
        }
        const trigger = event.currentTarget;
        const point = { x: event.clientX, y: event.clientY };
        const lastPoint = lastPointRef.current;
        lastPointRef.current = point;
        if (
            !lastPoint ||
            (lastPoint.x === point.x && lastPoint.y === point.y) ||
            open
        ) {
            return;
        }
        clearIntentTimers();
        prefetchTimerRef.current = window.setTimeout(() => {
            if (userId) {
                prefetchUserHoverCardProfile(userId);
            }
        }, openDelay / 2);
        openTimerRef.current = window.setTimeout(() => {
            if (
                Date.now() < suppressUntilRef.current ||
                (!trigger.closest(MODAL_CONTENT_SELECTOR) &&
                    document.querySelector(MODAL_OVERLAY_SELECTOR))
            ) {
                return;
            }
            setScrollClosed(false);
            setOpen(true);
        }, openDelay);
    }

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleScroll = (event: Event) => {
            const target = event.target;
            if (
                target instanceof Element &&
                target.closest('[data-slot="hover-card-content"]')
            ) {
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
            onOpenChange={(next, eventDetails) => {
                if (next && eventDetails.reason === 'trigger-hover') {
                    return;
                }
                if (next && Date.now() < suppressUntilRef.current) {
                    return;
                }
                if (!next) {
                    clearIntentTimers();
                }
                if (next) {
                    setScrollClosed(false);
                }
                setOpen(next);
            }}
        >
            <HoverCardTrigger
                delay={openDelay}
                closeDelay={closeDelay}
                render={children}
                onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch') {
                        lastPointRef.current = {
                            x: event.clientX,
                            y: event.clientY
                        };
                    }
                }}
                onPointerMove={handleIntentPointerMove}
                onPointerLeave={() => {
                    lastPointRef.current = null;
                    dismissedRef.current = false;
                    clearIntentTimers();
                }}
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
                    dismissedRef.current = true;
                    clearIntentTimers();
                    suppressUntilRef.current = getHoverOpenSuppressionDeadline(
                        Date.now(),
                        openDelay
                    );
                    setOpen(false);
                }}
            />
            <HoverCardContent
                className={cn(
                    'w-72 overflow-hidden p-0',
                    scrollClosed && 'data-closed:!animate-none'
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
