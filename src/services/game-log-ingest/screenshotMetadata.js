import { configRepository, gameLogRepository, mediaRepository } from '@/repositories/index.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { parseVrchatScreenshotDateFromFileName } from '@/shared/utils/screenshot.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { getFileNameFromPath, normalizeString } from './parsing.js';
import { getCurrentLocation, ingestState } from './state.js';

const SCREENSHOT_METADATA_FALLBACK_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;

function buildScreenshotMetadataContext() {
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

function resolveScreenshotTimestampFromInput(path, screenshotDateTime) {
    if (typeof screenshotDateTime === 'string' && screenshotDateTime) {
        const timestamp = Date.parse(screenshotDateTime);
        if (!Number.isNaN(timestamp)) {
            return timestamp;
        }
    }
    return parseVrchatScreenshotDateFromFileName(getFileNameFromPath(path));
}

async function resolveScreenshotTimestampFromFile(path) {
    try {
        const extra = await mediaRepository.getExtraScreenshotData(path, false);
        if (extra?.creationDate) {
            const timestamp = Date.parse(extra.creationDate);
            if (!Number.isNaN(timestamp)) {
                return timestamp;
            }
        }
    } catch (error) {
        console.warn('Failed to resolve screenshot timestamp:', error);
    }
    return null;
}

async function resolveScreenshotMetadataContext(path, screenshotDateTime) {
    const screenshotTimestamp =
        resolveScreenshotTimestampFromInput(path, screenshotDateTime) ??
        (await resolveScreenshotTimestampFromFile(path));
    if (screenshotTimestamp === null) {
        return null;
    }

    const screenshotDateIso = new Date(screenshotTimestamp).toJSON();
    const locationEntry =
        await gameLogRepository.getLocationBeforeOrAt(screenshotDateIso);
    if (!locationEntry?.location) {
        return null;
    }
    if (
        screenshotTimestamp - Date.parse(locationEntry.created_at) >
        SCREENSHOT_METADATA_FALLBACK_LOCATION_MAX_AGE_MS
    ) {
        return null;
    }

    const joinLeaveEntries =
        await gameLogRepository.getJoinLeaveEntriesForLocationRange(
            locationEntry.location,
            locationEntry.created_at,
            screenshotDateIso
        );

    const playerMap = new Map();
    for (const entry of joinLeaveEntries) {
        const playerKey = entry.userId || `display:${entry.displayName}`;
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
        location: locationEntry.location,
        worldName: locationEntry.worldName,
        players: Array.from(playerMap.values())
    };
}

async function processScreenshot(
    path,
    { screenshotDateTime, copyToClipboard: shouldCopyToClipboard = true } = {}
) {
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
            const currentUser =
                useRuntimeStore.getState().auth.currentUserSnapshot || {};
            const metadata = {
                application: 'VRCX',
                version: 1,
                author: {
                    id:
                        currentUser.id ||
                        useRuntimeStore.getState().auth.currentUserId ||
                        '',
                    displayName:
                        currentUser.displayName ||
                        useRuntimeStore.getState().auth
                            .currentUserDisplayName ||
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
        await mediaRepository.copyImageToClipboard(nextPath).catch((error) => {
            console.error('Failed to copy screenshot to clipboard:', error);
        });
    }

    return nextPath;
}

export { processScreenshot };
