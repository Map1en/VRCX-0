import { useEffect, useState, type ReactElement } from 'react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import type { InventoryItemRecord } from '@/repositories/vrchatMediaRepository';
import { Button } from '@/ui/shadcn/button';

import { resolveProfileDecorationAssetUrls } from '../userDialogProfileAppearance';
import { UserDialogProfileDecorationImage } from './UserDialogProfileDecorationImage';

interface UserDialogHeaderMediaProps {
    bannerAlt: string;
    bannerFallbackUrl: string;
    bannerUrl: string;
    iconFrame?: InventoryItemRecord;
    onBannerClick?: () => void;
    onOpenUserIcon: () => void;
    userIconLabel: string;
    userIconUrl: string;
}

export function UserDialogHeaderMedia({
    bannerAlt,
    bannerFallbackUrl,
    bannerUrl,
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

    return (
        <div className="relative">
            <Button
                type="button"
                variant="ghost"
                aria-label={bannerAlt}
                disabled={!displayedBannerUrl || !onBannerClick}
                onClick={onBannerClick}
                className={cn(
                    'bg-muted aspect-[4/3] h-auto w-full overflow-hidden rounded-lg border p-0 disabled:pointer-events-none disabled:opacity-100',
                    displayedBannerUrl ? 'cursor-pointer' : 'cursor-default'
                )}
            >
                {bannerUrl ? (
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
            ) : null}
        </div>
    );
}
