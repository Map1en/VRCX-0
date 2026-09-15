import type { ReactNode } from 'react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import { getFaviconUrl } from '@/shared/utils/urlUtils';

const MONOCHROME_FAVICON_HOSTS = new Set(['github.com']);

const FAVICON_HOST_ALIASES: Record<string, string> = {
    'twitter.com': 'x.com',
    'mobile.twitter.com': 'x.com'
};

function faviconHost(link: string): string {
    try {
        return new URL(link).host.replace(/^www\./, '');
    } catch {
        return '';
    }
}

export function BioLinkFavicon({
    link,
    className,
    fallback = null
}: {
    link: string;
    className?: string;
    fallback?: ReactNode;
}) {
    const host = faviconHost(link);
    const resolvedHost = FAVICON_HOST_ALIASES[host] || host;
    const src = resolvedHost
        ? getFaviconUrl(`https://${resolvedHost}`)
        : getFaviconUrl(link);
    if (!src) {
        return fallback;
    }

    return (
        <FadeInImage
            src={src}
            alt=""
            loading="lazy"
            fallback={fallback}
            className={cn(
                'size-4',
                MONOCHROME_FAVICON_HOSTS.has(resolvedHost) &&
                    'dark:opacity-85 dark:brightness-0 dark:invert',
                className
            )}
        />
    );
}
