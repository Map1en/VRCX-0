// @ts-nocheck
import { PackageIcon } from 'lucide-react';

import { MediaAssetTile } from './MediaAssetTile';

export function InventoryItemTile({
    title,
    description,
    timestamp,
    badges,
    imageUrl,
    alt,
    onPreview,
    primaryAction,
    menuActions,
    menuLabel
}) {
    const meta = [];
    if (description) {
        meta.push({
            key: 'description',
            label: description,
            title: description
        });
    }
    if (timestamp) {
        meta.push({
            key: 'timestamp',
            label: timestamp,
            title: timestamp
        });
    }

    return (
        <MediaAssetTile
            title={title}
            meta={meta}
            badges={badges}
            imageUrl={imageUrl}
            alt={alt}
            imageFit="contain"
            placeholderIcon={PackageIcon}
            onPreview={onPreview}
            primaryAction={primaryAction}
            menuActions={menuActions}
            menuLabel={menuLabel}
            contentClassName="min-h-20"
        />
    );
}
