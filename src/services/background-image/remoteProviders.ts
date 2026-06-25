import type {
    BackgroundImageProvider,
    BackgroundImageProviderId,
    BackgroundImageSnapshot
} from './types';

export const DEFAULT_BACKGROUND_IMAGE_PROVIDER_ID: BackgroundImageProviderId =
    'nasa-epic';

const NASA_EPIC_METADATA_URL = 'https://epic.gsfc.nasa.gov/api/natural';
const AIC_PUBLIC_DOMAIN_SEARCH_URL =
    'https://api.artic.edu/api/v1/artworks/search?query[term][is_public_domain]=true&fields=id,title,artist_display,image_id,is_public_domain&limit=100';
const AIC_DEFAULT_IIIF_URL = 'https://www.artic.edu/iiif/2';
const NASA_APOD_API_URL = 'https://api.nasa.gov/planetary/apod';
const NASA_APOD_API_KEY = 'DEMO_KEY';
const NASA_APOD_IMAGE_LOOKBACK_DAYS = 30;

interface NasaEpicEntry {
    image?: string;
    date?: string;
    caption?: string;
}

interface AicArtworkEntry {
    title?: string | null;
    artist_display?: string | null;
    image_id?: string | null;
    is_public_domain?: boolean;
}

interface AicSearchResponse {
    data?: AicArtworkEntry[];
    config?: {
        iiif_url?: string;
    };
}

interface NasaApodResponse {
    date?: string;
    title?: string;
    url?: string;
    hdurl?: string;
    media_type?: string;
    copyright?: string;
}

class BackgroundImageRateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackgroundImageRateLimitError';
    }
}

function currentDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function addUtcDays(date: Date, offsetDays: number): Date {
    const nextDate = new Date(date);
    nextDate.setUTCDate(nextDate.getUTCDate() + offsetDays);
    return nextDate;
}

function formatUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function stableDailyIndex(length: number): number {
    const date = currentDateKey();
    const seed = [...date].reduce(
        (value, char) => value + char.charCodeAt(0),
        0
    );
    return Math.abs(seed) % Math.max(1, length);
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { cache: 'no-cache' });
    if (response.status === 429) {
        throw new BackgroundImageRateLimitError(
            'Background Image provider rate limit reached.'
        );
    }
    if (!response.ok) {
        throw new Error(
            `Failed to load Background Image provider: ${response.status} ${response.statusText}`
        );
    }
    return (await response.json()) as T;
}

function buildSnapshot({
    providerId,
    imageUrl,
    title,
    author,
    license,
    source,
    resolvedForKey = currentDateKey()
}: {
    providerId: BackgroundImageProviderId;
    imageUrl: string;
    title: string;
    author: string;
    license: string;
    source: string;
    resolvedForKey?: string;
}): BackgroundImageSnapshot {
    return {
        mode: 'daily',
        providerId,
        imageUrl,
        title,
        author,
        license,
        source,
        resolvedAt: new Date().toISOString(),
        resolvedForKey
    };
}

function normalizeHttpsUrl(rawUrl: string, allowedHosts?: Set<string>): string {
    const parsedUrl = new URL(rawUrl);
    const normalizedHostname = parsedUrl.hostname.toLowerCase();
    const hostAllowed = !allowedHosts || allowedHosts.has(normalizedHostname);

    if (parsedUrl.protocol === 'http:' && hostAllowed && allowedHosts) {
        parsedUrl.protocol = 'https:';
    }
    if (parsedUrl.protocol !== 'https:') {
        throw new Error('Background Image must use HTTPS.');
    }
    if (!hostAllowed) {
        throw new Error('Background Image host is not allowed.');
    }
    return parsedUrl.toString();
}

async function resolveNasaEpicSnapshot(): Promise<BackgroundImageSnapshot> {
    const entries = await fetchJson<NasaEpicEntry[]>(NASA_EPIC_METADATA_URL);
    const entry = [...(Array.isArray(entries) ? entries : [])]
        .filter((item) => item.image && item.date)
        .sort((left, right) =>
            String(right.date || '').localeCompare(String(left.date || ''))
        )[0];
    if (!entry?.image || !entry.date) {
        throw new Error('NASA EPIC did not return image metadata.');
    }

    const [date] = entry.date.split(' ');
    const [yyyy, mm, dd] = date.split('-');
    const imageUrl = normalizeHttpsUrl(
        `https://epic.gsfc.nasa.gov/archive/natural/${yyyy}/${mm}/${dd}/jpg/${entry.image}.jpg`
    );

    return buildSnapshot({
        providerId: 'nasa-epic',
        imageUrl,
        title: entry.caption || 'Earth from DSCOVR EPIC',
        author: 'NASA EPIC / DSCOVR',
        license: 'NASA media usage guidelines',
        source: 'NASA EPIC'
    });
}

async function resolveAicSnapshot(): Promise<BackgroundImageSnapshot> {
    const payload = await fetchJson<AicSearchResponse>(
        AIC_PUBLIC_DOMAIN_SEARCH_URL
    );
    const artworks = (payload.data || []).filter(
        (item) => item.is_public_domain === true && item.image_id
    );
    if (!artworks.length) {
        throw new Error('AIC did not return public-domain image metadata.');
    }

    const artwork = artworks[stableDailyIndex(artworks.length)];
    const iiifBase = String(payload.config?.iiif_url || AIC_DEFAULT_IIIF_URL);
    const imageUrl = normalizeHttpsUrl(
        `${iiifBase}/${artwork.image_id}/full/1686,/0/default.jpg`
    );

    return buildSnapshot({
        providerId: 'aic-public-domain',
        imageUrl,
        title: String(artwork.title || 'Public domain artwork'),
        author: String(artwork.artist_display || 'Art Institute of Chicago'),
        license: 'Public Domain',
        source: 'Art Institute of Chicago'
    });
}

function normalizeApodImage(
    value: NasaApodResponse,
    resolvedForKey: string
): BackgroundImageSnapshot | null {
    if (value.media_type !== 'image' || String(value.copyright || '').trim()) {
        return null;
    }

    const rawImageUrl = String(value.hdurl || value.url || '').trim();
    if (!rawImageUrl) {
        return null;
    }

    const allowedHosts = new Set([
        'apod.nasa.gov',
        'www.nasa.gov',
        'images-assets.nasa.gov'
    ]);
    let imageUrl: string;
    try {
        imageUrl = normalizeHttpsUrl(rawImageUrl, allowedHosts);
    } catch {
        return null;
    }

    return {
        mode: 'daily',
        providerId: 'nasa-apod-safe',
        imageUrl,
        title: String(value.title || 'NASA Astronomy Picture of the Day'),
        author: 'NASA APOD',
        license: 'Public Domain / no copyright field',
        source: String(value.date || resolvedForKey),
        resolvedAt: new Date().toISOString(),
        resolvedForKey
    };
}

async function fetchApodByDate(date: string): Promise<NasaApodResponse | null> {
    const url = new URL(NASA_APOD_API_URL);
    url.searchParams.set('api_key', NASA_APOD_API_KEY);
    url.searchParams.set('thumbs', 'false');
    url.searchParams.set('date', date);

    const response = await fetch(url.toString(), { cache: 'no-cache' });
    if (response.status === 404) {
        return null;
    }
    if (response.status === 429) {
        throw new BackgroundImageRateLimitError(
            'NASA APOD rate limit reached.'
        );
    }
    if (!response.ok) {
        throw new Error(
            `Failed to load NASA APOD: ${response.status} ${response.statusText}`
        );
    }

    return (await response.json()) as NasaApodResponse;
}

async function resolveNasaApodSnapshot(): Promise<BackgroundImageSnapshot> {
    const resolvedForKey = currentDateKey();
    const today = new Date();
    for (let offset = 0; offset <= NASA_APOD_IMAGE_LOOKBACK_DAYS; offset += 1) {
        const date = formatUtcDate(addUtcDays(today, -offset));
        const entry = await fetchApodByDate(date);
        if (!entry) {
            continue;
        }

        const snapshot = normalizeApodImage(entry, resolvedForKey);
        if (snapshot) {
            return snapshot;
        }
    }

    throw new Error(
        'NASA APOD did not return a copyright-free image in the recent archive.'
    );
}

const backgroundImageRemoteProviderList: BackgroundImageProvider[] = [
    {
        id: 'nasa-epic',
        name: 'NASA EPIC',
        priority: 1,
        enabledByDefault: true,
        cacheTtlHours: 24,
        resolveSnapshot: resolveNasaEpicSnapshot
    },
    {
        id: 'aic-public-domain',
        name: 'Art Institute of Chicago',
        priority: 2,
        enabledByDefault: false,
        cacheTtlHours: 24,
        resolveSnapshot: resolveAicSnapshot
    },
    {
        id: 'nasa-apod-safe',
        name: 'NASA APOD',
        priority: 3,
        enabledByDefault: false,
        cacheTtlHours: 24,
        resolveSnapshot: resolveNasaApodSnapshot
    }
];

export const backgroundImageRemoteProviders: BackgroundImageProvider[] = [
    ...backgroundImageRemoteProviderList
].sort((left, right) => left.priority - right.priority);

export function resolveBackgroundImageProvider(
    value: unknown
): BackgroundImageProvider {
    const providerId = String(value || '').trim();
    return (
        backgroundImageRemoteProviders.find(
            (provider) => provider.id === providerId
        ) || backgroundImageRemoteProviders[0]
    );
}
