import {
    configRepository,
    gameLogRepository,
    webRepository
} from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { pushSharedFeedNotification } from '../sharedFeedFilterService.js';
import {
    convertYouTubeDurationToSeconds,
    normalizeString,
    parseWebJson,
    parseYouTubeVideoId
} from './parsing.js';
import { nowPlayingState } from './state.js';

function resetRuntimeNowPlayingState() {
    useRuntimeStore.getState().setNowPlayingState({
        url: '',
        name: '',
        source: '',
        displayName: '',
        thumbnailUrl: '',
        length: 0,
        position: 0,
        startedAt: null,
        updatedAt: new Date().toISOString()
    });
}

async function lookupYouTubeVideo(videoId) {
    const normalizedVideoId = normalizeString(videoId);
    if (!normalizedVideoId) {
        return null;
    }
    const [enabled, apiKey] = await Promise.all([
        configRepository.getBool('youtubeAPI', false).catch(() => false),
        configRepository.getString('youtubeAPIKey', '').catch(() => '')
    ]);
    if (!enabled || !apiKey) {
        return null;
    }
    try {
        const response = await webRepository.execute({
            url: `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(normalizedVideoId)}&part=snippet,contentDetails&key=${encodeURIComponent(apiKey)}`,
            method: 'GET'
        });
        const payload = parseWebJson(response);
        if (
            response.status !== 200 ||
            !Array.isArray(payload.items) ||
            !payload.items.length
        ) {
            return null;
        }
        const item = payload.items[0];
        const thumbnails = item?.snippet?.thumbnails || {};
        const thumbnail =
            thumbnails.maxres ||
            thumbnails.standard ||
            thumbnails.high ||
            thumbnails.medium ||
            thumbnails.default ||
            {};
        return {
            videoName: normalizeString(item?.snippet?.title),
            videoLength: convertYouTubeDurationToSeconds(
                item?.contentDetails?.duration
            ),
            thumbnailUrl: normalizeString(thumbnail.url)
        };
    } catch (error) {
        console.warn('Failed to lookup YouTube video metadata:', error);
        return null;
    }
}

async function resolveUserIdFromDisplayName(displayName) {
    const normalizedDisplayName = normalizeString(displayName);
    if (!normalizedDisplayName) {
        return '';
    }

    try {
        return normalizeString(
            await gameLogRepository.getUserIdFromDisplayName(
                normalizedDisplayName
            )
        );
    } catch (error) {
        console.warn('Failed to resolve video uploader display name:', error);
        return '';
    }
}

function createVideoEntry({
    dt,
    location,
    videoUrl,
    videoId = '',
    videoName = '',
    videoLength = 0,
    displayName = '',
    userId = '',
    videoPos = 8,
    thumbnailUrl = ''
}) {
    const youtubeId = videoId ? '' : parseYouTubeVideoId(videoUrl);
    return {
        created_at: dt,
        type: 'VideoPlay',
        videoUrl,
        videoId: videoId || (youtubeId ? 'YouTube' : ''),
        videoName: videoName || youtubeId || videoUrl,
        videoLength: Number(videoLength) || 0,
        location,
        displayName,
        userId,
        videoPos: Number(videoPos) || 0,
        thumbnailUrl
    };
}

async function createVideoEntryWithMetadata(args) {
    const entry = createVideoEntry(args);
    const youtubeId =
        entry.videoId === 'YouTube' ? parseYouTubeVideoId(entry.videoUrl) : '';
    if (!youtubeId) {
        return entry;
    }
    const metadata = await lookupYouTubeVideo(youtubeId);
    if (!metadata) {
        return entry;
    }
    return {
        ...entry,
        videoName: metadata.videoName || entry.videoName,
        videoLength: metadata.videoLength || entry.videoLength,
        thumbnailUrl: metadata.thumbnailUrl || entry.thumbnailUrl
    };
}

async function persistVideoEntry(entry) {
    if (!entry?.videoUrl) {
        return null;
    }

    entry.videoUrl = normalizeString(entry.videoUrl);
    if (!entry.videoUrl || nowPlayingState.url === entry.videoUrl) {
        return null;
    }

    if (!entry.userId && entry.displayName) {
        entry.userId = await resolveUserIdFromDisplayName(entry.displayName);
    }

    nowPlayingState.url = entry.videoUrl;
    useRuntimeStore.getState().setNowPlayingState({
        url: entry.videoUrl,
        name: entry.videoName || entry.videoUrl,
        source: entry.videoId || '',
        displayName: entry.displayName || '',
        thumbnailUrl: entry.thumbnailUrl || '',
        length: Number(entry.videoLength) || 0,
        position: Number(entry.videoPos) || 0,
        startedAt: entry.created_at || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    await gameLogRepository.addGamelogVideoPlayToDatabase(entry);
    void pushSharedFeedNotification({
        ...entry,
        message: [
            entry.videoName || entry.videoUrl,
            entry.displayName ? `(${entry.displayName})` : ''
        ]
            .filter(Boolean)
            .join(' '),
        notyName: [
            entry.videoName || entry.videoUrl,
            entry.displayName ? `(${entry.displayName})` : ''
        ]
            .filter(Boolean)
            .join(' ')
    }).catch((error) => {
        console.warn(
            'Failed to publish video shared feed notification:',
            error
        );
    });
    return entry;
}

async function persistProviderVideo(gameLog, location) {
    const data = normalizeString(gameLog.data);
    const type = data.slice(0, data.indexOf(' '));

    if (type === 'VideoPlay(PyPyDance)') {
        const match =
            /VideoPlay\(PyPyDance\) "(.+?)",([\d.]+),([\d.]+),"(.*)"/g.exec(
                data
            );
        if (!match) return null;
        const title = match[4];
        const parts = title.split('(');
        let displayName = parts.pop()?.slice(0, -1) || '';
        let source = parts.join('(');
        let videoId = '';
        if (source === 'Custom URL') {
            videoId = 'YouTube';
        } else {
            videoId = source.substr(0, source.indexOf(':') - 1);
            source = source.substr(source.indexOf(':') + 2);
        }
        if (displayName === 'Random') displayName = '';
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: match[1],
                videoPos: match[2],
                videoLength: match[3],
                videoId,
                videoName: source.slice(0, -1),
                displayName
            })
        );
    }

    if (
        type === 'VideoPlay(VRDancing)' ||
        type === 'VideoPlay(ZuwaZuwaDance)'
    ) {
        const match =
            /VideoPlay\((?:VRDancing|ZuwaZuwaDance)\) "(.+?)",([\d.]+),([\d.]+),(-?[\d.]+),"(.+?)","(.+?)"/g.exec(
                data
            );
        if (!match) return null;
        let videoId = match[4];
        let displayName = match[5];
        let videoName = match[6];
        if (videoId === '-1' || videoId === '9999') {
            videoId = 'YouTube';
        }
        const markerIndex = videoName.indexOf(']</b> ');
        if (markerIndex !== -1) {
            videoName = videoName.substring(markerIndex + 6);
        }
        if (displayName === 'Random') displayName = '';
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: match[1],
                videoPos: match[2] === match[3] ? 0 : match[2],
                videoLength: match[3],
                videoId,
                videoName,
                displayName
            })
        );
    }

    if (type === 'LSMedia') {
        const match = /LSMedia ([\d.]+),([\d.]+),(.+?),(.+?),(?=[^,]*$)/g.exec(
            data
        );
        if (!match) return null;
        const videoName = match[4];
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: videoName,
                videoPos: match[1],
                videoLength: match[2],
                videoId: 'LSMedia',
                videoName,
                displayName: match[3]
            })
        );
    }

    if (type === 'VideoPlay(PopcornPalace)') {
        const jsonStart = data.indexOf('{');
        if (jsonStart < 0) return null;
        let parsed;
        try {
            parsed = JSON.parse(data.substring(jsonStart));
        } catch (error) {
            console.warn('Failed to parse PopcornPalace video payload:', error);
            return null;
        }
        if (!parsed.videoName) {
            nowPlayingState.url = '';
            resetRuntimeNowPlayingState();
            return null;
        }
        return persistVideoEntry(
            await createVideoEntryWithMetadata({
                dt: gameLog.dt,
                location,
                videoUrl: parsed.videoName,
                videoPos: parsed.videoPos,
                videoLength: parsed.videoLength,
                videoId: 'PopcornPalace',
                videoName: parsed.videoName,
                displayName: parsed.displayName || '',
                thumbnailUrl: parsed.thumbnailUrl || ''
            })
        );
    }

    return null;
}

export {
    createVideoEntryWithMetadata,
    persistProviderVideo,
    persistVideoEntry,
    resetRuntimeNowPlayingState
};
