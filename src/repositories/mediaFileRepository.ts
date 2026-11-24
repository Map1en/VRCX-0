import { commands } from '@/platform/tauri/bindings';

function parseResponseValue(data: string): unknown {
    if (data === '') {
        return '';
    }

    try {
        return JSON.parse(data);
    } catch {
        return data;
    }
}

async function getScreenshotMetadata(path: string) {
    return parseResponseValue(await commands.appGetScreenshotMetadata(path));
}

async function getExtraScreenshotData(path: string, carouselCache = false) {
    return parseResponseValue(
        await commands.appGetExtraScreenshotData(path, carouselCache)
    );
}

const mediaFileRepository = Object.freeze({
    getScreenshotMetadata,
    getExtraScreenshotData
});

export default mediaFileRepository;
