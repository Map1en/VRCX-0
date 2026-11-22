import { useTranslation } from 'react-i18next';

import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';

import { contentTagLabel } from '../../world-dialog/worldDialogUtils';

const BADGE_LIMIT = 5;

export function AvatarDialogHeaderBadges({
    avatarBlocked,
    contentTags,
    hasImposter,
    imposterVersion,
    isFallback,
    isMarketplace
}: {
    avatarBlocked: boolean;
    contentTags: string[];
    hasImposter: boolean;
    imposterVersion: string;
    isFallback: boolean;
    isMarketplace: boolean;
}) {
    const { t } = useTranslation();
    const descriptors = [
        ...contentTags.map((tag) => ({
            key: tag,
            label: contentTagLabel(tag, t)
        })),
        ...(hasImposter
            ? [
                  {
                      key: 'impostor',
                      label: `${t('dialog.avatar.tags.impostor')}${imposterVersion ? ` v${imposterVersion}` : ''}`
                  }
              ]
            : []),
        ...(isFallback
            ? [{ key: 'fallback', label: t('dialog.avatar.tags.fallback') }]
            : []),
        ...(isMarketplace
            ? [
                  {
                      key: 'marketplace',
                      label: t('dialog.avatar.tags.marketplace')
                  }
              ]
            : [])
    ];

    if (!avatarBlocked && !descriptors.length) {
        return null;
    }
    const visible = descriptors.slice(0, BADGE_LIMIT);
    const hidden = descriptors.slice(BADGE_LIMIT);

    return (
        <>
            {avatarBlocked ? (
                <Badge variant="destructive">
                    {t('dialog.avatar.error.blocked')}
                </Badge>
            ) : null}
            {visible.map(({ key, label }) => (
                <Badge
                    key={key}
                    variant="outline"
                    className="text-muted-foreground max-w-full font-normal"
                >
                    <span className="truncate">{label}</span>
                </Badge>
            ))}
            {hidden.length ? (
                <HintTooltip
                    label={hidden.map(({ label }) => label).join(', ')}
                >
                    <Badge
                        variant="outline"
                        className="text-muted-foreground cursor-default font-normal tabular-nums"
                    >
                        +{hidden.length}
                    </Badge>
                </HintTooltip>
            ) : null}
        </>
    );
}
