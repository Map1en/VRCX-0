import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import {
    useEffect,
    useRef,
    useState,
    type ComponentPropsWithRef,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactElement,
    type ReactNode
} from 'react';

const HOVER_REST_MS = 60;

type Point = { x: number; y: number };

type PendingActivation = {
    replay:
        | { kind: 'hover'; entry: Point; last: Point }
        | { kind: 'contextmenu'; point: Point }
        | null;
    focusPath: number[] | null;
};

type MountOnIntentProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
    children: ReactElement;
    trigger: 'hover' | 'contextmenu';
    render(child: ReactElement): ReactNode;
};

function indexPathFrom(root: Element, target: Element): number[] | null {
    const path: number[] = [];
    let node = target;
    while (node !== root) {
        const parent = node.parentElement;
        if (!parent) {
            return null;
        }
        path.unshift(Array.prototype.indexOf.call(parent.children, node));
        node = parent;
    }
    return path;
}

function resolveIndexPath(
    root: Element,
    path: readonly number[]
): Element | null {
    let node: Element | undefined = root;
    for (const index of path) {
        node = node?.children[index];
    }
    return node ?? null;
}

function dispatchPointerLike(
    element: Element,
    type: string,
    point: Point,
    init: MouseEventInit = {}
) {
    const eventInit: PointerEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        pointerType: 'mouse',
        ...init
    };
    element.dispatchEvent(
        type.startsWith('pointer') && typeof PointerEvent === 'function'
            ? new PointerEvent(type, eventInit)
            : new MouseEvent(type, eventInit)
    );
}

function replayHover(element: Element, entry: Point, last: Point) {
    const parent = element.parentElement;
    if (parent) {
        dispatchPointerLike(parent, 'pointerout', entry, {
            relatedTarget: element
        });
        dispatchPointerLike(parent, 'mouseout', entry, {
            relatedTarget: element
        });
    }
    dispatchPointerLike(element, 'pointerenter', entry, { bubbles: false });
    dispatchPointerLike(element, 'mouseenter', entry, { bubbles: false });
    dispatchPointerLike(element, 'pointermove', last);
    dispatchPointerLike(element, 'mousemove', last);
}

export function MountOnIntent({
    children,
    trigger,
    render,
    ref,
    ...forwardedProps
}: MountOnIntentProps) {
    const [active, setActive] = useState(false);
    const elementRef = useRef<HTMLDivElement | null>(null);
    const pendingRef = useRef<PendingActivation | null>(null);
    const restTimerRef = useRef(0);
    const replayTimerRef = useRef(0);
    const pressedSinceEnterRef = useRef(false);
    const hoverPathRef = useRef<{ entry: Point; last: Point } | null>(null);

    useEffect(
        () => () => {
            window.clearTimeout(restTimerRef.current);
            window.clearTimeout(replayTimerRef.current);
        },
        []
    );

    function activate(replay: PendingActivation['replay']) {
        window.clearTimeout(restTimerRef.current);
        const element = elementRef.current;
        const focused = document.activeElement;
        pendingRef.current = {
            replay,
            focusPath:
                element && focused && element.contains(focused)
                    ? indexPathFrom(element, focused)
                    : null
        };
        setActive(true);
    }

    function cancelHover() {
        window.clearTimeout(restTimerRef.current);
        hoverPathRef.current = null;
    }

    function scheduleHover(
        event: ReactPointerEvent<Element>,
        entering: boolean
    ) {
        if (
            event.pointerType === 'touch' ||
            event.pointerType === 'pen' ||
            event.buttons !== 0 ||
            pressedSinceEnterRef.current
        ) {
            return;
        }
        const point = { x: event.clientX, y: event.clientY };
        const previous = hoverPathRef.current;
        const path =
            entering || !previous
                ? { entry: point, last: point }
                : { entry: previous.entry, last: point };
        hoverPathRef.current = path;
        window.clearTimeout(restTimerRef.current);
        restTimerRef.current = window.setTimeout(() => {
            activate({ kind: 'hover', ...path });
        }, HOVER_REST_MS);
    }

    const intentProps = active
        ? {}
        : trigger === 'hover'
          ? {
                onPointerEnter: (event: ReactPointerEvent<Element>) => {
                    scheduleHover(event, true);
                },
                onPointerMove: (event: ReactPointerEvent<Element>) => {
                    scheduleHover(event, false);
                },
                onPointerLeave: () => {
                    pressedSinceEnterRef.current = false;
                    cancelHover();
                },
                onPointerDown: () => {
                    pressedSinceEnterRef.current = true;
                    cancelHover();
                },
                onFocus: () => {
                    if (!pressedSinceEnterRef.current) {
                        activate(null);
                    }
                }
            }
          : {
                onContextMenu: (event: ReactMouseEvent<Element>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    activate({
                        kind: 'contextmenu',
                        point: { x: event.clientX, y: event.clientY }
                    });
                }
            };

    const child = useRender({
        render: children,
        ref: ref ? [ref, elementRef] : elementRef,
        props: mergeProps(forwardedProps, intentProps)
    });

    useEffect(() => {
        const pending = pendingRef.current;
        const element = elementRef.current;
        if (!active || !pending || !element) {
            return;
        }
        pendingRef.current = null;
        if (pending.focusPath) {
            const target = resolveIndexPath(element, pending.focusPath);
            if (target instanceof HTMLElement) {
                target.focus({ preventScroll: true });
            }
        }
        const { replay } = pending;
        if (replay?.kind === 'hover') {
            replayTimerRef.current = window.setTimeout(() => {
                if (element.isConnected) {
                    replayHover(element, replay.entry, replay.last);
                }
            }, 0);
        } else if (replay?.kind === 'contextmenu') {
            dispatchPointerLike(element, 'contextmenu', replay.point, {
                button: 2
            });
        }
    }, [active]);

    return active ? render(child) : child;
}
