import { GiftIcon, ImageIcon, RefreshCwIcon } from 'lucide-react';

import { formatDateFilter } from '@/lib/dateTime';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { TabsContent } from '@/ui/shadcn/tabs';

import { EmptyState, LoadingState } from './GalleryViewParts';

function getInventoryTypeLabel(item: any, t: any) {
    if (item.itemType === 'prop') {
        return t('dialog.gallery_icons.item');
    }
    if (item.itemType === 'sticker') {
        return t('dialog.gallery_icons.sticker');
    }
    if (item.itemType === 'droneskin') {
        return t('dialog.gallery_icons.drone_skin');
    }
    if (item.itemType === 'emoji') {
        return t('dialog.gallery_icons.emoji');
    }
    return item.itemTypeLabel || item.itemType || 'Item';
}

export function GalleryInventoryTab({
    t,
    items,
    loading,
    mutatingKey,
    gridDensityConfig,
    onRefresh,
    onRedeem,
    onPreview,
    onConsumeBundle
}: any) {
    return (
        <TabsContent
            value="inventory"
            className="mt-2 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
        >
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <CardHeader className="gap-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <CardTitle>
                                {t('dialog.gallery_icons.inventory')}
                            </CardTitle>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onRefresh('inventory')}
                            >
                                <RefreshCwIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.refresh')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={mutatingKey === 'inventory:redeem'}
                                onClick={onRedeem}
                            >
                                <GiftIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.redeem')}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <LoadingState />
                    ) : items.length > 0 ? (
                        <div
                            className={`${gridDensityConfig.inventoryGridClass} p-1`}
                        >
                            {items.map((item: any) => {
                                const isMutating =
                                    mutatingKey === `inventory:${item.id}`;
                                return (
                                    <Card
                                        key={item.id}
                                        className="overflow-hidden"
                                    >
                                        {item.imageUrl ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="h-auto w-full rounded-none p-0"
                                                onClick={() =>
                                                    onPreview({
                                                        id: item.id,
                                                        url: item.imageUrl,
                                                        title:
                                                            item.name || item.id
                                                    })
                                                }
                                            >
                                                <img
                                                    src={item.imageUrl}
                                                    alt={item.name || item.id}
                                                    loading="lazy"
                                                    className="aspect-square w-full object-cover"
                                                />
                                            </Button>
                                        ) : (
                                            <div className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center">
                                                <ImageIcon className="size-8" />
                                            </div>
                                        )}
                                        <CardContent
                                            className={
                                                gridDensityConfig.contentClass
                                            }
                                        >
                                            <div
                                                className={
                                                    gridDensityConfig.metaClass
                                                }
                                            >
                                                <div className="line-clamp-1 text-sm font-medium">
                                                    {item.name || item.id}
                                                </div>
                                                {item.description ? (
                                                    <div className="text-muted-foreground line-clamp-1 text-xs">
                                                        {item.description}
                                                    </div>
                                                ) : null}
                                                {item.created_at ? (
                                                    <div className="text-muted-foreground line-clamp-1 font-mono text-xs">
                                                        {formatDateFilter(
                                                            item.created_at,
                                                            'long'
                                                        )}
                                                    </div>
                                                ) : null}
                                                <Badge variant="outline">
                                                    {getInventoryTypeLabel(
                                                        item,
                                                        t
                                                    )}
                                                </Badge>
                                            </div>
                                            {item.itemType === 'bundle' ? (
                                                <Button
                                                    size="sm"
                                                    className={
                                                        gridDensityConfig.actionButtonClass
                                                    }
                                                    disabled={isMutating}
                                                    onClick={() =>
                                                        onConsumeBundle(item.id)
                                                    }
                                                >
                                                    {t(
                                                        'dialog.gallery_icons.consume_bundle'
                                                    )}
                                                </Button>
                                            ) : null}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    ) : (
                        <EmptyState
                            title={t(
                                'view.tools.empty.no_inventory_items_loaded'
                            )}
                            description={t(
                                'view.tools.action.refresh_this_tab_to_load_inventory_items'
                            )}
                        />
                    )}
                </CardContent>
            </Card>
        </TabsContent>
    );
}
