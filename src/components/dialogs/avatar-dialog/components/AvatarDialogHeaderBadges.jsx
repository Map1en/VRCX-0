import {
    AppleIcon,
    HeartIcon,
    MonitorIcon,
    SmartphoneIcon,
    UserIcon
} from 'lucide-react';

import { appI18n } from '@/services/i18nService.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

function PlatformBadge({ label, rating, fileSize, icon: Icon }) {
    return (
        <Badge variant="outline">
            {Icon ? <Icon data-icon="inline-start" /> : null}
            {label}
            {rating ? <span className="ml-1 border-l pl-1">{rating}</span> : null}
            {fileSize ? (
                <span className="ml-1 border-l pl-1">{fileSize}</span>
            ) : null}
        </Badge>
    );
}

export function AvatarDialogHeaderBadges({
    avatar,
    isCurrentAvatar,
    avatarBlocked,
    isFavorite,
    platformInfo,
    fileAnalysis,
    contentTags,
    authorTags,
    hasImposter,
    imposterVersion,
    onOpenCache
}) {
    return (
        <>
            <Badge
                variant={avatar.releaseStatus === 'public' ? 'default' : 'outline'}
            >
                {avatar.releaseStatus === 'public'
                    ? appI18n.t('dialog.avatar.tags.public')
                    : appI18n.t('dialog.avatar.tags.private')}
            </Badge>
            {isCurrentAvatar ? (
                <Badge variant="secondary">
                    <UserIcon data-icon="inline-start" />
                    {appI18n.t('common.current_session')}
                </Badge>
            ) : null}
            {avatarBlocked ? (
                <Badge variant="destructive">
                    {appI18n.t('dialog.avatar.generated.blocked')}
                </Badge>
            ) : null}
            {isFavorite ? (
                <Badge>
                    <HeartIcon data-icon="inline-start" className="fill-current" />
                    {appI18n.t('dialog.avatar.generated.favorite')}
                </Badge>
            ) : null}
            {avatar.$isCached ? (
                <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="rounded-full"
                    onClick={onOpenCache}
                >
                    {avatar.$cacheSize
                        ? `${avatar.$cacheSize} ${appI18n.t('dialog.avatar.tags.cache')}`
                        : appI18n.t('dialog.avatar.tags.cache')}
                </Button>
            ) : null}
            {hasImposter ? (
                <Badge variant="outline">
                    {appI18n.t('dialog.avatar.tags.impostor')}
                    {imposterVersion ? ` v${imposterVersion}` : ''}
                </Badge>
            ) : null}
            {avatar.styles?.primary || avatar.styles?.secondary ? (
                <Badge variant="outline">
                    {appI18n.t('view.favorite.avatars.styles')} {avatar.styles?.primary || ''}
                    {avatar.styles?.secondary
                        ? ` / ${avatar.styles.secondary}`
                        : ''}
                </Badge>
            ) : null}
            {avatar.unityPackageUrl || avatar.unityPackage?.url ? (
                <Badge variant="outline">
                    {appI18n.t('dialog.avatar.generated.future_proofing')}
                </Badge>
            ) : null}
            {avatar.tags?.some((tag) => /quest/i.test(tag)) ? (
                <Badge variant="outline">
                    {appI18n.t('dialog.avatar.tags.fallback')}
                </Badge>
            ) : null}
            {platformInfo?.pc?.platform ? (
                <PlatformBadge
                    label="PC"
                    rating={platformInfo.pc.performanceRating}
                    fileSize={fileAnalysis.standalonewindows?._fileSize}
                    icon={MonitorIcon}
                />
            ) : null}
            {platformInfo?.android?.platform ? (
                <PlatformBadge
                    label={appI18n.t('dialog.avatar.generated.android')}
                    rating={platformInfo.android.performanceRating}
                    fileSize={fileAnalysis.android?._fileSize}
                    icon={SmartphoneIcon}
                />
            ) : null}
            {platformInfo?.ios?.platform ? (
                <PlatformBadge
                    label="iOS"
                    rating={platformInfo.ios.performanceRating}
                    fileSize={fileAnalysis.ios?._fileSize}
                    icon={AppleIcon}
                />
            ) : null}
            {contentTags.map((tag) => (
                <Badge key={tag} variant="outline">
                    {tag.replace('content_', '')}
                </Badge>
            ))}
            {authorTags.map((tag) => (
                <Badge key={tag} variant="outline">
                    {tag.replace('author_tag_', '')}
                </Badge>
            ))}
        </>
    );
}
