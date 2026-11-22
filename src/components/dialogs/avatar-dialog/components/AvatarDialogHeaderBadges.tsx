import { useTranslation } from 'react-i18next';

import { Badge } from '@/ui/shadcn/badge';

import { contentTagLabel } from '../../world-dialog/worldDialogUtils';

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

    return (
        <>
            {avatarBlocked ? (
                <Badge variant="destructive">
                    {t('dialog.avatar.error.blocked')}
                </Badge>
            ) : null}
            {descriptors.map(({ key, label }) => (
                <Badge
                    key={key}
                    variant="outline"
                    className="text-muted-foreground max-w-full font-normal"
                >
                    <span className="truncate">{label}</span>
                </Badge>
            ))}
        </>
    );
}
