import { CheckIcon, ImageIcon, RefreshCwIcon, StoreIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import vrchatEconomyRepository, {
    type EconomyListingRecord
} from '@/repositories/vrchatEconomyRepository';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import { economyImageUrl, listingPrice, listingTerm } from './economyDisplay';
import { useOwnedEconomyItems } from './useOwnedEconomyItems';

type LoadState =
    | { status: 'loading' }
    | { status: 'ready'; listings: EconomyListingRecord[] }
    | { status: 'error'; error: unknown };

export function EconomyStoreListings({ storeId }: { storeId: string }) {
    const { t } = useTranslation();
    const [refreshToken, setRefreshToken] = useState(0);
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const listings = state.status === 'ready' ? state.listings : [];
    const owned = useOwnedEconomyItems(listings.length > 0);

    useEffect(() => {
        let active = true;
        setState({ status: 'loading' });
        vrchatEconomyRepository
            .getStoreListings({ storeId, force: refreshToken > 0 })
            .then((nextListings) => {
                if (active) {
                    setState({ status: 'ready', listings: nextListings });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState({ status: 'error', error });
                }
            });
        return () => {
            active = false;
        };
    }, [refreshToken, storeId]);

    return (
        <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                    {t('economy.store_read_only_hint')}
                </span>
                <HintTooltip label={t('common.actions.refresh')}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={state.status === 'loading'}
                        onClick={() => setRefreshToken((value) => value + 1)}
                    >
                        <RefreshCwIcon />
                    </Button>
                </HintTooltip>
            </div>
            {state.status === 'loading' ? (
                <LoadingState variant="panel" />
            ) : state.status === 'error' ? (
                <EmptyState
                    variant="panel"
                    title={t('economy.store_failed_to_load')}
                    description={userFacingErrorMessage(state.error)}
                />
            ) : listings.length === 0 ? (
                <EmptyState
                    variant="panel"
                    icon={StoreIcon}
                    title={t('economy.store_empty')}
                />
            ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {listings.map((listing, index) => {
                        const listingId = listing.listingId || listing.id || '';
                        const isOwned =
                            (listingId !== '' &&
                                owned.listingIds.has(listingId)) ||
                            (listing.productIds ?? []).some((productId) =>
                                owned.productIds.has(productId)
                            );
                        return (
                            <StoreListingCard
                                key={listingId || index}
                                listing={listing}
                                owned={isOwned}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function StoreListingCard({
    listing,
    owned
}: {
    listing: EconomyListingRecord;
    owned: boolean;
}) {
    const { t } = useTranslation();
    const price = listingPrice(listing, t);
    const imageUrl = economyImageUrl(listing.imageUrl, listing.imageId);

    return (
        <div className="flex min-w-0 gap-3 rounded-lg border p-2">
            <span className="bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : (
                    <ImageIcon className="text-muted-foreground size-5" />
                )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                    {listing.displayName || listing.listingId || listing.id}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                    {listingTerm(listing, t)}
                </span>
                {listing.description ? (
                    <span className="text-muted-foreground line-clamp-2 text-xs">
                        {listing.description}
                    </span>
                ) : null}
                <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
                    <span className="text-sm font-medium tabular-nums">
                        {price.label}
                    </span>
                    {price.vrcPlusLabel ? (
                        <span className="text-muted-foreground text-xs tabular-nums">
                            {price.vrcPlusLabel}
                        </span>
                    ) : null}
                    {owned ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400">
                            <CheckIcon data-icon="inline-start" />
                            {t('economy.owned')}
                        </Badge>
                    ) : null}
                </span>
            </span>
        </div>
    );
}
