import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type PointerEvent } from 'react';

import {
    normalizeProfileAppearanceColor,
    resolveProfileDecorationAssetUrls
} from '@/components/dialogs/user-dialog/userDialogProfileAppearance';
import { FadeInImage } from '@/components/media/FadeInImage';
import { entityQueryPolicies } from '@/lib/entityQueryCache';
import { cn } from '@/lib/utils';
import vrchatMediaRepository, {
    type InventoryItemRecord
} from '@/repositories/vrchatMediaRepository';

const DECORATION_FADE_OUT_MS = 500;

function useProfileDecorationItem(templateId: string) {
    return useQuery({
        queryKey: ['profileDecoration', templateId],
        queryFn: async () =>
            (await vrchatMediaRepository.getInventoryTemplate(templateId)).json,
        enabled: Boolean(templateId),
        staleTime: entityQueryPolicies.inventoryTemplate.staleTime,
        gcTime: entityQueryPolicies.inventoryTemplate.gcTime,
        retry: false,
        refetchOnWindowFocus: false
    }).data;
}

function DecorationImage({
    item,
    animated,
    className,
    imageClassName
}: {
    item: InventoryItemRecord | undefined;
    animated: boolean;
    className: string;
    imageClassName: string;
}) {
    const [failedAnimatedUrl, setFailedAnimatedUrl] = useState('');
    const [fadingOut, setFadingOut] = useState(false);
    const [wasAnimated, setWasAnimated] = useState(animated);
    if (wasAnimated !== animated) {
        setWasAnimated(animated);
        setFadingOut(!animated);
    }
    useEffect(() => {
        if (!fadingOut) {
            return undefined;
        }
        const timer = setTimeout(
            () => setFadingOut(false),
            DECORATION_FADE_OUT_MS
        );
        return () => clearTimeout(timer);
    }, [fadingOut]);
    const { animatedUrl, staticUrl } = resolveProfileDecorationAssetUrls(item);
    const src = staticUrl || animatedUrl;
    if (!src) {
        return null;
    }
    const showAnimation =
        (animated || fadingOut) &&
        Boolean(animatedUrl) &&
        animatedUrl !== src &&
        animatedUrl !== failedAnimatedUrl;
    return (
        <span
            aria-hidden="true"
            className={cn('pointer-events-none block', className)}
        >
            <FadeInImage
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                fallback={null}
                className={cn('size-full', imageClassName)}
            />
            {showAnimation ? (
                <span
                    data-decoration-animation={animated ? 'on' : 'fading'}
                    className={cn(
                        'absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none',
                        animated ? 'opacity-100' : 'opacity-0'
                    )}
                >
                    <FadeInImage
                        src={animatedUrl}
                        alt=""
                        decoding="async"
                        fallback={null}
                        className={cn('size-full', imageClassName)}
                        onError={() => setFailedAnimatedUrl(animatedUrl)}
                    />
                </span>
            ) : null}
        </span>
    );
}

export function useDecorationHover() {
    const [hoverTarget, setHoverTarget] = useState<Element | null>(null);

    useEffect(() => {
        if (!hoverTarget) {
            return;
        }
        const handlePointerMove = (event: globalThis.PointerEvent) => {
            if (
                !(event.target instanceof Node) ||
                !hoverTarget.contains(event.target)
            ) {
                setHoverTarget(null);
            }
        };
        document.addEventListener('pointermove', handlePointerMove, true);
        return () => {
            document.removeEventListener(
                'pointermove',
                handlePointerMove,
                true
            );
        };
    }, [hoverTarget]);

    return {
        active: hoverTarget !== null,
        hoverProps: {
            onPointerEnter: (event: PointerEvent<HTMLElement>) =>
                setHoverTarget(event.currentTarget),
            onPointerLeave: () => setHoverTarget(null)
        }
    };
}

export function ProfileAvatarFrame({
    templateId,
    active
}: {
    templateId: string;
    active: boolean;
}) {
    const item = useProfileDecorationItem(templateId);
    return (
        <DecorationImage
            item={item}
            animated={active}
            className="absolute -inset-[18.75%] z-5"
            imageClassName="object-contain"
        />
    );
}

export function ProfileEffect({
    templateId,
    active
}: {
    templateId: string;
    active: boolean;
}) {
    const item = useProfileDecorationItem(templateId);
    return (
        <DecorationImage
            item={item}
            animated={active}
            className="absolute inset-x-0 top-0 z-20 aspect-[4/5]"
            imageClassName="object-cover"
        />
    );
}

export function ProfileNameplate({
    templateId,
    active
}: {
    templateId: string;
    active: boolean;
}) {
    const item = useProfileDecorationItem(templateId);
    if (!item) {
        return null;
    }
    const gradientStart = normalizeProfileAppearanceColor(
        item.metadata?.gradientStart
    );
    const gradientEnd = normalizeProfileAppearanceColor(
        item.metadata?.gradientEnd
    );
    return (
        <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0.5 right-0 -z-10 w-2/3 overflow-hidden rounded-[inherit] [mask-image:linear-gradient(to_left,black,rgb(0_0_0/0.7)_25%,rgb(0_0_0/0.3)_55%,rgb(0_0_0/0.08)_80%,transparent)]"
        >
            <span
                style={
                    gradientStart && gradientEnd
                        ? {
                              backgroundImage: `linear-gradient(90deg, ${gradientStart}, ${gradientEnd})`
                          }
                        : undefined
                }
                className={cn(
                    'absolute inset-0 transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-50'
                )}
            >
                <DecorationImage
                    item={item}
                    animated={active}
                    className="absolute inset-0"
                    imageClassName="object-cover"
                />
            </span>
        </span>
    );
}
