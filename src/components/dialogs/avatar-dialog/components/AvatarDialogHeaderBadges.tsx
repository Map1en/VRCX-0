import {
    AppleIcon,
    MonitorIcon,
    PersonStandingIcon,
    RectangleGogglesIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PlatformFileAnalysis } from '@/domain/entities/profileEntities';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import type {
    AvatarPlatformInfo,
    AvatarViewRecord
} from '../avatarDialogTypes';

function PlatformBadge({
    label,
    rating,
    fileSize,
    icon: Icon
}: {
    label: string;
    rating?: string;
    fileSize?: string;
    icon?: LucideIcon;
}) {
    return (
        <Badge variant="outline">
            {Icon ? <Icon data-icon="inline-start" /> : null}
            {label}
            {rating ? (
                <span className="ml-1 border-l pl-1">{rating}</span>
            ) : null}
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
    platformInfo,
    fileAnalysis,
    contentTags,
    authorTags,
    hasImposter,
    imposterVersion,
    onOpenCache
}: {
    avatar: AvatarViewRecord;
    isCurrentAvatar: boolean;
    avatarBlocked: boolean;
    platformInfo: AvatarPlatformInfo;
    fileAnalysis: PlatformFileAnalysis;
    contentTags: string[];
    authorTags: string[];
    hasImposter: boolean;
    imposterVersion: string;
    onOpenCache(): void;
}) {
    const { t } = useTranslation();

    return (
        <>
            <Badge
                variant={
                    avatar.releaseStatus === 'public' ? 'default' : 'outline'
                }
            >
                {avatar.releaseStatus === 'public'
                    ? t('dialog.avatar.tags.public')
                    : t('dialog.avatar.tags.private')}
            </Badge>
            {isCurrentAvatar ? (
                <Badge variant="secondary">
                    <PersonStandingIcon data-icon="inline-start" />
                    {t('common.current_session')}
                </Badge>
            ) : null}
            {avatarBlocked ? (
                <Badge variant="destructive">
                    {t('dialog.avatar.error.blocked')}
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
                        ? `${avatar.$cacheSize} ${t('dialog.avatar.tags.cache')}`
                        : t('dialog.avatar.tags.cache')}
                </Button>
            ) : null}
            {hasImposter ? (
                <Badge variant="outline">
                    {t('dialog.avatar.tags.impostor')}
                    {imposterVersion ? ` v${imposterVersion}` : ''}
                </Badge>
            ) : null}
            {avatar.styles?.primary || avatar.styles?.secondary ? (
                <Badge variant="outline">
                    {t('view.favorite.avatars.styles')}{' '}
                    {avatar.styles?.primary || ''}
                    {avatar.styles?.secondary
                        ? ` / ${avatar.styles.secondary}`
                        : ''}
                </Badge>
            ) : null}
            {avatar.unityPackageUrl || avatar.unityPackage?.url ? (
                <Badge variant="outline">
                    {t('dialog.avatar.tags.future_proofing')}
                </Badge>
            ) : null}
            {avatar.tags.some((tag) => /quest/i.test(tag)) ? (
                <Badge variant="outline">
                    {t('dialog.avatar.tags.fallback')}
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
                    label="Android"
                    rating={platformInfo.android.performanceRating}
                    fileSize={fileAnalysis.android?._fileSize}
                    icon={RectangleGogglesIcon}
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
