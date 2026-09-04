export type ReleaseChannel = 'stable' | 'beta';

export interface ReleaseVersionInfo {
    major: number;
    minor: number;
    patchNumber: number;
    betaNumber: number | null;
    channel: ReleaseChannel;
    buildVersion: string;
    canonicalVersion: string;
    displayVersion: string;
}

const MAX_MAJOR_VERSION = 99;
const MAX_MINOR_VERSION = 999;
const MAX_PATCH_VERSION = 999;
const MAX_BETA_VERSION = 999999;
const RELEASE_VERSION_PATTERN =
    /^v?(?<major>[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)(?:-beta\.(?<beta>[1-9][0-9]*))?$/;

function isBoundedInteger(value: number, max: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= max;
}

function buildVersionInfo(
    major: number,
    minor: number,
    patch: number,
    betaNumber: number | null
): ReleaseVersionInfo {
    const baseVersion = `${major}.${minor}.${patch}`;
    const canonicalVersion =
        betaNumber === null ? baseVersion : `${baseVersion}-beta.${betaNumber}`;

    return {
        major,
        minor,
        patchNumber: patch,
        betaNumber,
        channel: betaNumber === null ? 'stable' : 'beta',
        buildVersion: canonicalVersion,
        canonicalVersion,
        displayVersion: canonicalVersion
    };
}

export function parseReleaseVersion(
    version: string
): ReleaseVersionInfo | null {
    const normalizedVersion = version.trim();
    const match = RELEASE_VERSION_PATTERN.exec(normalizedVersion);
    if (!match?.groups) {
        return null;
    }

    const major = Number.parseInt(match.groups.major, 10);
    const minor = Number.parseInt(match.groups.minor, 10);
    const patch = Number.parseInt(match.groups.patch, 10);
    const betaNumber = match.groups.beta
        ? Number.parseInt(match.groups.beta, 10)
        : null;
    if (
        !isBoundedInteger(major, MAX_MAJOR_VERSION) ||
        !Number.isInteger(minor) ||
        minor < 0 ||
        minor > MAX_MINOR_VERSION ||
        !Number.isInteger(patch) ||
        patch < 0 ||
        patch > MAX_PATCH_VERSION ||
        (betaNumber !== null && !isBoundedInteger(betaNumber, MAX_BETA_VERSION))
    ) {
        return null;
    }

    return buildVersionInfo(major, minor, patch, betaNumber);
}

export function formatReleaseDisplayVersion(version: string): string {
    return parseReleaseVersion(version)?.displayVersion ?? version.trim();
}

export function releaseChannelForVersion(
    version: string
): ReleaseChannel | null {
    return parseReleaseVersion(version)?.channel ?? null;
}

export function compareReleaseVersions(
    left: string | ReleaseVersionInfo | null,
    right: string | ReleaseVersionInfo | null
): number {
    const parsedLeft =
        typeof left === 'string' ? parseReleaseVersion(left) : left;
    const parsedRight =
        typeof right === 'string' ? parseReleaseVersion(right) : right;

    if (!parsedLeft && !parsedRight) {
        return 0;
    }
    if (!parsedLeft) {
        return -1;
    }
    if (!parsedRight) {
        return 1;
    }

    const coreComparison =
        parsedLeft.major - parsedRight.major ||
        parsedLeft.minor - parsedRight.minor ||
        parsedLeft.patchNumber - parsedRight.patchNumber;
    if (coreComparison !== 0) {
        return coreComparison;
    }
    if (parsedLeft.betaNumber === null) {
        return parsedRight.betaNumber === null ? 0 : 1;
    }
    if (parsedRight.betaNumber === null) {
        return -1;
    }
    return parsedLeft.betaNumber - parsedRight.betaNumber;
}
