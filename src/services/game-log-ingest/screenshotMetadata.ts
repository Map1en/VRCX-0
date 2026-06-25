import configRepository from '@/repositories/configRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import mediaRepository from '@/repositories/mediaRepository';
import { parseLocation } from '@/shared/utils/location';
import { parseVrchatScreenshotDateFromFileName } from '@/shared/utils/screenshot';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';

import { getFileNameFromPath } from './parsing';
import { getCurrentLocation, ingestState } from './state';

const SCREENSHOT_METADATA_FALLBACK_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;

type ScreenshotPlayer = {
    userId?: unknown;
    displayName?: unknown;
};

type ScreenshotMetadataContext = {
    location: string;
    worldName?: unknown;
    players: ScreenshotPlayer[];
};

type ScreenshotOptions = {
    screenshotDateTime?: unknown;
    copyToClipboard?: boolean;
};

type LocationEntry = Record<string, unknown> & {
    location?: unknown;
    worldName?: unknown;
    created_at?: unknown;
};

type ScreenshotExtra = {
    creationDate?: unknown;
};
type ScreenshotMetadata = {
    application: 'VRCX-0';
    version: number;
    author: {
        id: unknown;
        displayName: unknown;
    };
    world: {
        name: unknown;
        id: string;
        instanceId: string;
    };
    players: Array<{
        id: unknown;
        displayName: unknown;
    }>;
};

function buildScreenshotMetadataContext(): ScreenshotMetadataContext | null {
    const location = getCurrentLocation();
    if (!location) {
        return null;
    }

    return {
        location,
        worldName:
            ingestState.currentWorldName ||
            normalizeString(
                useRuntimeStore.getState().gameState.currentWorldName
            ),
        players: Array.from(ingestState.playersByKey.values()).map(
            (player) => ({
                userId: player.userId || '',
                displayName: player.displayName || ''
            })
        )
    };
}

function resolveScreenshotTimestampFromInput(
    path: unknown,
    screenshotDateTime: unknown
): number | null {
    if (typeof screenshotDateTime === 'string' && screenshotDateTime) {
        const timestamp = Date.parse(screenshotDateTime);
        if (!Number.isNaN(timestamp)) {
            return timestamp;
        }
    }
    return parseVrchatScreenshotDateFromFileName(getFileNameFromPath(path));
}

async function resolveScreenshotTimestampFromFile(
    path: string
): Promise<number | null> {
    try {
        const extra = (await mediaRepository.getExtraScreenshotData(
            path,
            false
        )) as ScreenshotExtra | null | undefined;
        if (extra?.creationDate) {
            const timestamp = Date.parse(normalizeString(extra.creationDate));
            if (!Number.isNaN(timestamp)) {
                return timestamp;
            }
        }
    } catch (error) {
        console.warn('Failed to resolve screenshot timestamp:', error);
    }
    return null;
}

async function resolveScreenshotMetadataContext(
    path: string,
    screenshotDateTime: unknown
): Promise<ScreenshotMetadataContext | null> {
    const screenshotTimestamp =
        resolveScreenshotTimestampFromInput(path, screenshotDateTime) ??
        (await resolveScreenshotTimestampFromFile(path));
    if (screenshotTimestamp === null) {
        return null;
    }

    const screenshotDateIso = new Date(screenshotTimestamp).toJSON();
    const locationEntry = (await gameLogRepository.getLocationBeforeOrAt(
        screenshotDateIso
    )) as LocationEntry | null | undefined;
    if (!locationEntry?.location) {
        return null;
    }
    const location = normalizeString(locationEntry.location);
    const createdAt = normalizeString(locationEntry.created_at);
    if (!location || !createdAt) {
        return null;
    }
    if (
        screenshotTimestamp - Date.parse(createdAt) >
        SCREENSHOT_METADATA_FALLBACK_LOCATION_MAX_AGE_MS
    ) {
        return null;
    }

    const joinLeaveEntries =
        await gameLogRepository.getJoinLeaveEntriesForLocationRange(
            location,
            createdAt,
            screenshotDateIso
        );

    const playerMap = new Map<string, ScreenshotPlayer>();
    for (const entry of Array.isArray(joinLeaveEntries)
        ? joinLeaveEntries
        : []) {
        const playerKey = normalizeString(
            entry.userId || `display:${entry.displayName}`
        );
        if (entry.type === 'OnPlayerJoined') {
            playerMap.set(playerKey, {
                userId: entry.userId,
                displayName: entry.displayName
            });
        } else if (entry.type === 'OnPlayerLeft') {
            playerMap.delete(playerKey);
        }
    }

    return {
        location,
        worldName: locationEntry.worldName,
        players: Array.from(playerMap.values())
    };
}

async function processScreenshot(
    path: unknown,
    {
        screenshotDateTime,
        copyToClipboard: shouldCopyToClipboard = true
    }: ScreenshotOptions = {}
): Promise<string> {
    const screenshotPath = normalizeString(path);
    if (!screenshotPath) {
        return '';
    }

    const [screenshotHelper, modifyFilename, copyToClipboard] =
        await Promise.all([
            configRepository.getBool('screenshotHelper', true),
            configRepository.getBool('screenshotHelperModifyFilename', false),
            configRepository.getBool('screenshotHelperCopyToClipboard', false)
        ]);

    let nextPath = screenshotPath;
    if (screenshotHelper) {
        const screenshotContext =
            buildScreenshotMetadataContext() ??
            (await resolveScreenshotMetadataContext(
                screenshotPath,
                screenshotDateTime
            ));
        if (screenshotContext?.location) {
            const location = parseLocation(screenshotContext.location);
            const authState = useRuntimeStore.getState().auth;
            const currentUser =
                authState.currentUserSnapshot &&
                typeof authState.currentUserSnapshot === 'object'
                    ? authState.currentUserSnapshot
                    : {};
            const metadata: ScreenshotMetadata = {
                application: 'VRCX-0',
                version: 1,
                author: {
                    id: currentUser.id || authState.currentUserId || '',
                    displayName:
                        currentUser.displayName ||
                        authState.currentUserDisplayName ||
                        ''
                },
                world: {
                    name: screenshotContext.worldName || '',
                    id: location.worldId,
                    instanceId: screenshotContext.location
                },
                players: screenshotContext.players.map((player) => ({
                    id: player.userId || '',
                    displayName: player.displayName || ''
                }))
            };

            try {
                const metadataPath =
                    await mediaRepository.addScreenshotMetadata(
                        screenshotPath,
                        JSON.stringify(metadata),
                        location.worldId,
                        modifyFilename
                    );
                if (metadataPath) {
                    nextPath = metadataPath;
                }
            } catch (error) {
                console.error('Failed to add screenshot metadata:', error);
                return screenshotPath;
            }
        }
    }

    if (copyToClipboard && shouldCopyToClipboard) {
        await mediaRepository
            .copyImageToClipboard(nextPath)
            .catch((error: unknown) => {
                console.error('Failed to copy screenshot to clipboard:', error);
            });
    }

    return nextPath;
}

export { processScreenshot };
