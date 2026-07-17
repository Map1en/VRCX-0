import { createDensityPreset } from '@/lib/densityPreset';

export type FeedColumnDensity = 'compact' | 'dense';

export type FeedColumnDensityConfig = {
    value: FeedColumnDensity;
    rowHeight: number;
    showAvatar: boolean;
    avatarSize: number;
    itemClassName: string;
    avatarClassName: string;
    rowPaddingClassName: string;
    contentGapClassName: string;
    topRowGapClassName: string;
    userLinkClassName: string;
    detailClassName: string;
};

export const DEFAULT_FEED_COLUMN_DENSITY: FeedColumnDensity = 'compact';

export const FEED_COLUMN_DENSITY_OPTIONS = Object.freeze([
    {
        value: 'compact',
        labelKey: 'view.feed.columns.density_options.compact'
    },
    {
        value: 'dense',
        labelKey: 'view.feed.columns.density_options.dense'
    }
]);

const DENSITY_CONFIGS: Record<FeedColumnDensity, FeedColumnDensityConfig> =
    Object.freeze({
        compact: Object.freeze({
            value: 'compact',
            rowHeight: 60,
            showAvatar: true,
            avatarSize: 32,
            itemClassName: 'grid-cols-[auto_minmax(0,1fr)] items-center gap-2',
            avatarClassName: 'self-center',
            rowPaddingClassName: 'px-2 py-1',
            contentGapClassName: 'gap-0.5',
            topRowGapClassName: 'gap-1.5',
            userLinkClassName: 'h-5 text-xs',
            detailClassName: 'text-xs leading-4'
        }),
        dense: Object.freeze({
            value: 'dense',
            rowHeight: 48,
            showAvatar: false,
            avatarSize: 0,
            itemClassName: '',
            avatarClassName: '',
            rowPaddingClassName: 'px-2 py-1',
            contentGapClassName: 'gap-0.5',
            topRowGapClassName: 'gap-1.5',
            userLinkClassName: 'h-5 text-xs',
            detailClassName: 'text-xs leading-4'
        })
    });

const preset = createDensityPreset(
    DEFAULT_FEED_COLUMN_DENSITY,
    DENSITY_CONFIGS
);

export const sanitizeFeedColumnDensity = preset.sanitize;

export const getFeedColumnDensityConfig = preset.getConfig;
