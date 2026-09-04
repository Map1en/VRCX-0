import type { EntityRecord } from './shared';

export type UnityPackageRecord = EntityRecord & {
    assetUrl?: string;
    assetVersion?: number;
    created_at?: string;
    id?: string;
    platform?: string;
    performanceRating?: string;
    impostorizerVersion?: string;
    scanStatus?: string;
    unitySortNumber?: number;
    unityVersion?: string;
    variant?: string;
    worldSignature?: string;
};

export type FileAnalysisRecord = {
    _fileSize?: string;
};

export type PlatformFileAnalysis = Record<string, FileAnalysisRecord>;

export type WorldProfileRecord = EntityRecord & {
    id: string;
    name: string;
    description: string;
    authorId: string;
    authorName: string;
    capacity: number;
    created_at?: string;
    createdAt: string;
    defaultContentSettings?: EntityRecord;
    disabledPropAbilities?: string[];
    favorites: number;
    featured?: boolean;
    fileAnalysis?: PlatformFileAnalysis;
    hasPersistData?: boolean;
    heat: number;
    imageUrl: string;
    instances?: unknown[];
    isLabs: boolean;
    labsPublicationDate?: string | null;
    occupants: number;
    organization?: string;
    platforms: string[];
    popularity: number;
    previewYoutubeId?: string | null;
    privateOccupants?: number;
    publicOccupants?: number;
    publicationDate: string | null;
    recommendedCapacity: number;
    releaseStatus: string;
    slimInstances?: unknown[];
    tags: string[];
    thumbnailImageUrl: string;
    udonProducts?: unknown[];
    unityPackages?: UnityPackageRecord[];
    updated_at?: string;
    updatedAt: string;
    urlList?: string[];
    version?: number;
    visits: number;
    $cacheLocked?: boolean;
    $cachePath?: string;
    $cacheSize?: string;
    $isCached?: boolean;
};
