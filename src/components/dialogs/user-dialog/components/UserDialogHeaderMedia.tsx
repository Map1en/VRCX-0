import { UserIcon } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import type { InventoryItemRecord } from '@/repositories/vrchatMediaRepository';
import { Button } from '@/ui/shadcn/button';

import { resolveProfileDecorationAssetUrls } from '../userDialogProfileAppearance';
import { UserDialogProfileDecorationImage } from './UserDialogProfileDecorationImage';

interface UserDialogHeaderMediaProps {
    bannerAlt: string;
    bannerColor: string;
    bannerFallbackUrl: string;
    bannerUrl: string;
    collapsed?: boolean;
    fallbackInitial?: string;
    iconFrame?: InventoryItemRecord;
    onBannerClick?: () => void;
    onOpenUserIcon: () => void;
    userIconLabel: string;
    userIconUrl: string;
}

export function UserDialogHeaderMedia({
    bannerAlt,
    bannerColor,
    bannerFallbackUrl,
    bannerUrl,
    collapsed = false,
    fallbackInitial = '',
    iconFrame,
    onBannerClick,
    onOpenUserIcon,
    userIconLabel,
    userIconUrl
}: UserDialogHeaderMediaProps): ReactElement {
    const { animatedUrl, staticUrl } =
        resolveProfileDecorationAssetUrls(iconFrame);
    const hasIconFrame = Boolean(animatedUrl || staticUrl);
    const displayedBannerUrl = bannerUrl || bannerFallbackUrl;
    const [loadedBannerUrl, setLoadedBannerUrl] = useState('');
    useEffect(() => {
        if (!bannerUrl) {
            setLoadedBannerUrl('');
        }
    }, [bannerUrl]);
    const previousBannerUrl =
        bannerUrl && loadedBannerUrl !== bannerUrl ? loadedBannerUrl : '';
    const fallbackImage = bannerFallbackUrl ? (
        <FadeInImage
            src={bannerFallbackUrl}
            alt={bannerAlt}
            className="size-full object-cover"
            fallback={null}
        />
    ) : null;
    const avatarPlaceholder = (
        <span
            aria-hidden="true"
            className="bg-muted text-muted-foreground flex size-full items-center justify-center rounded-full border-2 border-white text-lg font-semibold shadow-md"
        >
            {fallbackInitial || <UserIcon className="size-1/2" />}
        </span>
    );

    if (collapsed) {
        return (
            <div
                data-header-media="collapsed"
                className="bg-muted relative flex h-16 w-full items-center rounded-lg border px-3"
            >
                <div className="size-11">{avatarPlaceholder}</div>
            </div>
        );
    }

    return (
        <div className="relative">
            <Button
                type="button"
                variant="ghost"
                aria-label={bannerAlt}
                disabled={
                    Boolean(bannerColor) ||
                    !displayedBannerUrl ||
                    !onBannerClick
                }
                onClick={onBannerClick}
                className={cn(
                    'bg-muted aspect-[4/3] h-auto w-full overflow-hidden rounded-lg border p-0 disabled:pointer-events-none disabled:opacity-100',
                    displayedBannerUrl && !bannerColor
                        ? 'cursor-pointer'
                        : 'cursor-default'
                )}
            >
                {bannerColor ? (
                    <span
                        className="size-full"
                        style={{ backgroundColor: bannerColor }}
                    />
                ) : bannerUrl ? (
                    <span className="relative size-full">
                        {[previousBannerUrl, bannerUrl]
                            .filter(Boolean)
                            .map((url) => (
                                <FadeInImage
                                    key={url}
                                    src={url}
                                    alt={url === bannerUrl ? bannerAlt : ''}
                                    className="absolute inset-0 size-full object-cover"
                                    fallback={
                                        url === bannerUrl ? fallbackImage : null
                                    }
                                    onLoad={() => setLoadedBannerUrl(url)}
                                />
                            ))}
                    </span>
                ) : (
                    fallbackImage
                )}
            </Button>
            {userIconUrl ? (
                <div className="absolute bottom-3 left-3 z-30 size-16">
                    <Button
                        type="button"
                        variant="ghost"
                        aria-label={userIconLabel}
                        title={userIconLabel}
                        className={cn(
                            'bg-background/90 relative z-0 size-full overflow-hidden rounded-full p-0 shadow-md',
                            hasIconFrame ? 'border-0' : 'border-2 border-white'
                        )}
                        onClick={onOpenUserIcon}
                    >
                        <FadeInImage
                            src={userIconUrl}
                            alt=""
                            className="size-full object-cover"
                        />
                    </Button>
                    {hasIconFrame ? (
                        <UserDialogProfileDecorationImage
                            item={iconFrame}
                            className="absolute -inset-3 z-10"
                            imageClassName="object-contain"
                        />
                    ) : null}
                </div>
            ) : (
                <div className="absolute bottom-3 left-3 z-30 size-16">
                    {avatarPlaceholder}
                </div>
            )}
        </div>
    );
}
