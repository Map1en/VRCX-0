const SCREENSHOT_FILE_NAME_REGEX =
    /VRChat_((\d{3,})x(\d{3,})_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(\d{1,})|(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(\d{3})_(\d{3,})x(\d{3,}))/;

function parseVrchatScreenshotDateFromFileName(
    fileName: unknown
): number | null {
    const match = String(fileName || '').match(SCREENSHOT_FILE_NAME_REGEX);
    if (!match) {
        return null;
    }

    let year;
    let month;
    let day;
    let hour;
    let minute;
    let second;
    let millisecond;

    if (typeof match[2] !== 'undefined' && match[4]?.length === 4) {
        year = Number(match[4]);
        month = Number(match[5]);
        day = Number(match[6]);
        hour = Number(match[7]);
        minute = Number(match[8]);
        second = Number(match[9]);
        millisecond = Number(match[10]);
    } else if (typeof match[11] !== 'undefined' && match[11]?.length === 4) {
        year = Number(match[11]);
        month = Number(match[12]);
        day = Number(match[13]);
        hour = Number(match[14]);
        minute = Number(match[15]);
        second = Number(match[16]);
        millisecond = Number(match[17]);
    } else {
        return null;
    }

    const timestamp = new Date(
        year,
        month - 1,
        day,
        hour,
        minute,
        second,
        millisecond
    ).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}

export { parseVrchatScreenshotDateFromFileName };
