import type { EntityRecord } from './shared';
import type { PlatformFileAnalysis, UnityPackageRecord } from './world';

export type AvatarStyleSelection = EntityRecord & {
    primary?: string | null;
    secondary?: string | null;
};

export type AvatarLocalTag = {
    tag: string;
    color?: string | null;
};

type AvatarPerformanceRecord = EntityRecord & {
    android?: string;
    'android-sort'?: number;
    ios?: string;
    'ios-sort'?: number;
    standalonewindows?: string;
    'standalonewindows-sort'?: number;
};

export type AvatarProfileRecord = EntityRecord & {
    id: string;
    name: string;
    description: string;
    acknowledgements?: string | null;
    attribution?: string | null;
    authorId: string;
    authorName: string;
    created_at: string;
    createdAt?: string;
    featured?: boolean;
    fileAnalysis?: PlatformFileAnalysis;
    gallery?: EntityRecord[];
    galleryImages?: (string | EntityRecord)[];
    imageUrl: string;
    listingDate?: string | null;
    pendingUpload?: boolean;
    performance?: AvatarPerformanceRecord;
    releaseStatus: string;
    searchable?: boolean;
    styles?: AvatarStyleSelection;
    tags: string[];
    thumbnailImageUrl: string;
    unityPackageUrl?: string;
    unityPackageUrlObject?: EntityRecord & { unityPackageUrl?: string };
    unityPackages: UnityPackageRecord[];
    updated_at: string;
    updatedAt?: string;
    version: number;
    $cacheLocked?: boolean;
    $cachePath?: string;
    $cacheSize?: string;
    $isCached: boolean;
    $memo: string;
    $tags: AvatarLocalTag[];
    $timeSpent: number;
};
