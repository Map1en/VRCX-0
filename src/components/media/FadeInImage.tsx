import {
    useLayoutEffect,
    useRef,
    useState,
    type ComponentProps,
    type ReactNode
} from 'react';

import { cn } from '@/lib/utils';

type FadeInImageProps = Omit<ComponentProps<'img'>, 'alt'> & {
    alt: string;
    fade?: boolean;
    fallback?: ReactNode;
};

function FadeInImage({
    alt,
    className,
    fade = true,
    fallback,
    onLoad,
    onError,
    ...props
}: FadeInImageProps) {
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [instant, setInstant] = useState(false);
    const [failed, setFailed] = useState(false);

    useLayoutEffect(() => {
        const img = imgRef.current;
        const cached = Boolean(img && img.complete && img.naturalWidth > 0);
        setInstant(cached);
        setLoaded(cached);
        setFailed(false);
    }, [props.src]);

    if (failed && fallback !== undefined) {
        return <>{fallback}</>;
    }

    return (
        <img
            {...props}
            alt={alt}
            ref={imgRef}
            className={cn(
                fade && (loaded ? 'opacity-100' : 'opacity-0'),
                fade && !instant && 'transition-opacity duration-200 ease-out',
                className
            )}
            onLoad={(event) => {
                setLoaded(true);
                onLoad?.(event);
            }}
            onError={(event) => {
                setLoaded(true);
                setFailed(true);
                onError?.(event);
            }}
        />
    );
}

export { FadeInImage };
