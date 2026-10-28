import { parseReleaseVersion } from '@/shared/utils/releaseVersion';

export function isThemeTestedWithOlderRelease(
    testedWith: string,
    appVersion: string
) {
    const tested = parseReleaseVersion(testedWith);
    const current = parseReleaseVersion(appVersion);
    if (!tested || !current) {
        return false;
    }
    return (
        tested.major < current.major ||
        (tested.major === current.major && tested.minor < current.minor)
    );
}
