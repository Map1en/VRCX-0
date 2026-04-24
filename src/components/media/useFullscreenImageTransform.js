import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_STEP = 1.1;
const INITIAL_TRANSFORM = Object.freeze({
    scale: 1,
    rotate: 0,
    tx: 0,
    ty: 0
});

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function degToRad(value) {
    return (value * Math.PI) / 180;
}

export function useFullscreenImageTransform({ open, url }) {
    const viewerRef = useRef(null);
    const transformRef = useRef(INITIAL_TRANSFORM);
    const dragRef = useRef({
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        startTx: 0,
        startTy: 0
    });
    const [transform, setTransform] = useState(INITIAL_TRANSFORM);

    useEffect(() => {
        transformRef.current = transform;
    }, [transform]);

    const resetTransform = useCallback(() => {
        setTransform(INITIAL_TRANSFORM);
    }, []);

    useEffect(() => {
        if (open) {
            resetTransform();
        }
    }, [open, resetTransform, url]);

    const zoomBy = useCallback((factor) => {
        setTransform((current) => ({
            ...current,
            scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE)
        }));
    }, []);

    const zoomIn = useCallback(() => {
        zoomBy(ZOOM_STEP);
    }, [zoomBy]);

    const zoomOut = useCallback(() => {
        zoomBy(1 / ZOOM_STEP);
    }, [zoomBy]);

    const zoomAtPointer = useCallback(
        (event, factor) => {
            const element = viewerRef.current;
            if (!element) {
                zoomBy(factor);
                return;
            }

            const rect = element.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;
            const cx = rect.width / 2;
            const cy = rect.height / 2;

            setTransform((current) => {
                const oldScale = current.scale;
                const newScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
                const radians = degToRad(current.rotate);
                const cos = Math.cos(radians);
                const sin = Math.sin(radians);
                const vx = mx - cx - current.tx;
                const vy = my - cy - current.ty;
                const ux = (vx * cos + vy * sin) / oldScale;
                const uy = (-vx * sin + vy * cos) / oldScale;
                const nextVx = (ux * cos - uy * sin) * newScale;
                const nextVy = (ux * sin + uy * cos) * newScale;

                return {
                    ...current,
                    scale: newScale,
                    tx: mx - cx - nextVx,
                    ty: my - cy - nextVy
                };
            });
        },
        [zoomBy]
    );

    const rotateClockwise = useCallback(() => {
        setTransform((current) => ({
            ...current,
            rotate: (current.rotate + 90) % 360
        }));
    }, []);

    const rotateCounterClockwise = useCallback(() => {
        setTransform((current) => ({
            ...current,
            rotate: (current.rotate - 90 + 360) % 360
        }));
    }, []);

    const handleWheel = useCallback(
        (event) => {
            event.preventDefault();
            event.stopPropagation();
            zoomAtPointer(
                event,
                event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
            );
        },
        [zoomAtPointer]
    );

    const handlePointerDown = useCallback((event) => {
        if (event.button !== 0) {
            return;
        }

        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);

        const current = transformRef.current;
        dragRef.current = {
            active: true,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startTx: current.tx,
            startTy: current.ty
        };
    }, []);

    const handlePointerMove = useCallback((event) => {
        const drag = dragRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) {
            return;
        }

        event.stopPropagation();
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;

        setTransform((current) => ({
            ...current,
            tx: drag.startTx + dx,
            ty: drag.startTy + dy
        }));
    }, []);

    const handlePointerUp = useCallback((event) => {
        const drag = dragRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId) {
            return;
        }

        event.stopPropagation();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        dragRef.current = {
            ...dragRef.current,
            active: false,
            pointerId: null
        };
    }, []);

    const transformStyle = useMemo(
        () => ({
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale}) rotate(${transform.rotate}deg)`,
            transformOrigin: 'center center'
        }),
        [transform.rotate, transform.scale, transform.tx, transform.ty]
    );

    return {
        viewerRef,
        transformStyle,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handleWheel,
        resetTransform,
        rotateClockwise,
        rotateCounterClockwise,
        zoomIn,
        zoomOut
    };
}
