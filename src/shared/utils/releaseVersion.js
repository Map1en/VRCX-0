const RELEASE_VERSION_PATTERN =
    /^v?(?<year>\d+)\.(?<month>\d+)\.(?<day>\d+)(?:-beta\.(?<beta>\d+))?$/;

/**
 * @param {string} version
 * @returns {null | {
 *   year: number,
 *   month: number,
 *   day: number,
 *   betaNumber: number | null,
 *   channel: 'Stable' | 'Beta',
 *   canonicalVersion: string,
 *   displayVersion: string
 * }}
 */
function parseReleaseVersion(version) {
    const normalizedVersion = String(version || '').trim();
    const match = RELEASE_VERSION_PATTERN.exec(normalizedVersion);
    if (!match?.groups) {
        return null;
    }

    const year = Number.parseInt(match.groups.year, 10);
    const month = Number.parseInt(match.groups.month, 10);
    const day = Number.parseInt(match.groups.day, 10);
    const betaNumber = match.groups.beta
        ? Number.parseInt(match.groups.beta, 10)
        : null;

    if (
        Number.isNaN(year) ||
        Number.isNaN(month) ||
        Number.isNaN(day) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        (match.groups.beta && (Number.isNaN(betaNumber) || betaNumber < 1))
    ) {
        return null;
    }

    const canonicalVersion = `${year}.${month}.${day}${
        betaNumber ? `-beta.${betaNumber}` : ''
    }`;
    const displayVersion = `${year}.${String(month).padStart(2, '0')}.${String(
        day
    ).padStart(2, '0')}${betaNumber ? `-beta.${betaNumber}` : ''}`;

    return {
        year,
        month,
        day,
        betaNumber,
        channel: betaNumber ? 'Beta' : 'Stable',
        canonicalVersion,
        displayVersion
    };
}

/**
 * @param {string} version
 * @returns {string}
 */
function formatReleaseDisplayVersion(version) {
    return parseReleaseVersion(version)?.displayVersion || String(version || '');
}

/**
 * @param {string} version
 * @returns {boolean}
 */
function isBetaReleaseVersion(version) {
    return parseReleaseVersion(version)?.channel === 'Beta';
}

/**
 * @param {string | ReturnType<typeof parseReleaseVersion>} left
 * @param {string | ReturnType<typeof parseReleaseVersion>} right
 * @returns {number}
 */
function compareReleaseVersions(left, right) {
    const parsedLeft = typeof left === 'string' ? parseReleaseVersion(left) : left;
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

    const dateDelta =
        parsedLeft.year - parsedRight.year ||
        parsedLeft.month - parsedRight.month ||
        parsedLeft.day - parsedRight.day;
    if (dateDelta !== 0) {
        return dateDelta;
    }

    if (parsedLeft.channel !== parsedRight.channel) {
        return parsedLeft.channel === 'Stable' ? 1 : -1;
    }

    return (parsedLeft.betaNumber || 0) - (parsedRight.betaNumber || 0);
}

export {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    isBetaReleaseVersion,
    parseReleaseVersion
};
