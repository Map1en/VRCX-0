import { CoffeeIcon, HeartIcon, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { openExternalLink } from '@/services/entityMediaService';
import { links } from '@/shared/constants/link';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    useAboutContributors,
    type AboutContributor
} from './useAboutContributors';

const WORDMARK_FONT_LINK_ID = 'vrcx-0-about-wordmark-font';
const WORDMARK_FONT_URL =
    'https://fonts.googleapis.com/css2?family=Jost:wght@500&text=VRCX-0&display=swap';

const PLATFORM_LABELS: Record<string, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux'
};

type AboutActionLink = {
    key: string;
    labelKey?: string;
    label?: string;
    href: string;
    icon: LucideIcon;
};

const SUPPORT_LINKS: AboutActionLink[] = [
    {
        key: 'github-sponsors',
        labelKey: 'support_vrcx.github_sponsors',
        href: links.githubSponsors,
        icon: HeartIcon
    },
    {
        key: 'kofi',
        labelKey: 'support_vrcx.kofi',
        href: links.kofi,
        icon: CoffeeIcon
    },
    {
        key: 'afdian',
        label: '爱发电',
        href: links.afdian,
        icon: HeartIcon
    }
];

function ensureWordmarkFontLoaded() {
    if (document.getElementById(WORDMARK_FONT_LINK_ID)) {
        return;
    }
    const link = document.createElement('link');
    link.id = WORDMARK_FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = WORDMARK_FONT_URL;
    document.head.appendChild(link);
}

function getAppDisplayVersion(): string {
    // oxlint-disable-next-line no-undef
    return formatReleaseDisplayVersion(VERSION || '') || String(VERSION || '');
}

function ContributorNode({
    contributor,
    index
}: {
    contributor: AboutContributor;
    index: number;
}) {
    const initials = contributor.login.slice(0, 2).toUpperCase();

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        className={cn(
                            'animate-in fade-in slide-in-from-bottom-2 fill-mode-both rounded-full transition-transform duration-200 hover:z-10 hover:scale-110 motion-reduce:animate-none',
                            index % 2 === 1 && 'mt-2'
                        )}
                        style={{ animationDelay: `${index * 45}ms` }}
                        onClick={() => {
                            openExternalLink(contributor.profileUrl);
                        }}
                    >
                        <Avatar className="size-11">
                            <AvatarImage
                                src={contributor.avatarUrl}
                                alt={contributor.login}
                                loading="lazy"
                            />
                            <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>
                    </button>
                }
            />
            <TooltipContent>{contributor.login}</TooltipContent>
        </Tooltip>
    );
}

function AboutContributorsWall({ open }: { open: boolean }) {
    const { t } = useTranslation();
    const contributorsQuery = useAboutContributors(open);
    const contributors = contributorsQuery.data ?? [];

    return (
        <div className="flex min-h-11 flex-wrap items-start justify-center gap-2">
            {contributorsQuery.isPending
                ? Array.from({ length: 10 }, (_, index) => (
                      <Skeleton
                          key={index}
                          className={cn(
                              'size-11 rounded-full',
                              index % 2 === 1 && 'mt-2'
                          )}
                      />
                  ))
                : null}
            {contributorsQuery.isError ? (
                <p className="text-muted-foreground self-center text-xs">
                    {t('view.about.contributors_error')}
                </p>
            ) : null}
            {contributors.map((contributor, index) => (
                <ContributorNode
                    key={contributor.login}
                    contributor={contributor}
                    index={index}
                />
            ))}
        </div>
    );
}

export function AboutVrcxDialog({
    open,
    onOpenChange,
    onOpenLicenses
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenLicenses: () => void;
}) {
    const { t } = useTranslation();
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );

    useEffect(() => {
        if (open) {
            ensureWordmarkFontLoaded();
        }
    }, [open]);

    const displayVersion = getAppDisplayVersion();
    const platformLabel = PLATFORM_LABELS[hostPlatform] || '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="gap-0 px-7 pt-8 pb-6 sm:max-w-[560px]"
            >
                <div className="flex flex-col items-center text-center">
                    <DialogTitle
                        className="text-4xl leading-none font-medium tracking-normal select-none"
                        style={{ fontFamily: "'Jost', var(--font-sans)" }}
                    >
                        VRCX-0
                    </DialogTitle>
                    <DialogDescription className="mt-3 text-[13px]">
                        {t('view.about.tagline')}
                    </DialogDescription>
                    <div className="text-muted-foreground mt-3 inline-flex h-6 items-center justify-center gap-2 text-xs">
                        <span className="text-foreground/80 font-mono tracking-normal tabular-nums">
                            {displayVersion}
                        </span>
                        {platformLabel ? (
                            <>
                                <span
                                    aria-hidden="true"
                                    className="bg-muted-foreground/35 size-1 rounded-full"
                                />
                                <span>{platformLabel}</span>
                            </>
                        ) : null}
                    </div>
                </div>

                <div className="my-5 text-center">
                    <span className="text-muted-foreground/75 text-[10px] font-medium tracking-[0.18em] uppercase">
                        {t('view.about.contributors')}
                    </span>
                </div>

                <AboutContributorsWall open={open} />

                <div className="text-muted-foreground/70 mt-5 text-center text-xs">
                    <p className="mx-auto max-w-sm text-balance">
                        {t('view.about.thanks')}
                    </p>
                </div>

                <div className="mt-7 mb-4 text-center">
                    <span className="text-muted-foreground/75 text-[10px] font-medium tracking-[0.18em] uppercase">
                        {t('support_vrcx.title')}
                    </span>
                </div>

                <div className="flex justify-center">
                    <div className="flex flex-wrap justify-center gap-2">
                        {SUPPORT_LINKS.map(
                            ({ key, labelKey, label, href, icon: Icon }) => (
                                <Button
                                    key={key}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                        openExternalLink(href);
                                    }}
                                >
                                    <Icon data-icon="inline-start" />
                                    {labelKey ? t(labelKey) : label}
                                </Button>
                            )
                        )}
                    </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="text-muted-foreground/70 hover:text-foreground h-auto p-0 text-[11.5px] font-normal"
                        onClick={() => {
                            openExternalLink(links.license);
                        }}
                    >
                        {t('view.about.license_line')}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground/70 hover:text-foreground h-7 px-2 text-[11.5px] font-medium"
                        onClick={onOpenLicenses}
                    >
                        {t('app_menu.open_source_licenses')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
