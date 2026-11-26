import { STORAGE_KEYS, writeStoredText } from '@/lib/browserStorage';
import configRepository from '@/repositories/configRepository';
import storageRepository from '@/repositories/storageRepository';

const CONFIG_KEYS_MOVED_TO_BROWSER_STORAGE: ReadonlyArray<
    readonly [configKey: string, storageKey: string]
> = [
    ['VRCX_navPanelWidth', STORAGE_KEYS.navPanelWidth],
    ['VRCX_FavoritesFriendSplitter', STORAGE_KEYS.favoritesFriendSplitter],
    ['VRCX_FavoritesWorldSplitter', STORAGE_KEYS.favoritesWorldSplitter],
    ['VRCX_FavoritesAvatarSplitter', STORAGE_KEYS.favoritesAvatarSplitter],
    ['VRCX_FavoritesFriendDensity', STORAGE_KEYS.favoritesFriendDensity],
    ['VRCX_FavoritesWorldDensity', STORAGE_KEYS.favoritesWorldDensity],
    ['VRCX_FavoritesAvatarDensity', STORAGE_KEYS.favoritesAvatarDensity],
    ['InstanceActivityBarWidth', STORAGE_KEYS.instanceActivityBarWidth],
    ['FriendLocationDensity', STORAGE_KEYS.friendLocationDensity],
    ['activityJourneyDensity', STORAGE_KEYS.activityJourneyDensity],
    ['feedColumnsDensity', STORAGE_KEYS.feedColumnsDensity],
    ['MutualGraphLayoutIterations', STORAGE_KEYS.mutualGraphLayoutIterations],
    ['MutualGraphLayoutSpacing', STORAGE_KEYS.mutualGraphLayoutSpacing],
    ['MutualGraphEdgeCurvature', STORAGE_KEYS.mutualGraphEdgeCurvature],
    [
        'MutualGraphCommunitySeparation',
        STORAGE_KEYS.mutualGraphCommunitySeparation
    ],
    [
        'screenshotGalleryScrollPositions',
        STORAGE_KEYS.screenshotGalleryScrollPositions
    ]
];

const PROFILE_FILE_KEYS_MOVED_TO_BROWSER_STORAGE: ReadonlyArray<
    readonly [fileKey: string, storageKey: string]
> = [['tool:vrchatLog:prefs', STORAGE_KEYS.vrchatLogViewerPrefs]];

export async function moveLayoutPreferencesToBrowserStorage(): Promise<void> {
    for (const [
        configKey,
        storageKey
    ] of CONFIG_KEYS_MOVED_TO_BROWSER_STORAGE) {
        const value = await configRepository.getRawValue(configKey);
        if (value === null) {
            continue;
        }
        writeStoredText(storageKey, value);
        await configRepository.remove(configKey);
    }
    for (const [
        fileKey,
        storageKey
    ] of PROFILE_FILE_KEYS_MOVED_TO_BROWSER_STORAGE) {
        const value = await storageRepository.getString(fileKey, null);
        if (value === null) {
            continue;
        }
        writeStoredText(storageKey, value);
        await storageRepository.remove(fileKey);
    }
}
