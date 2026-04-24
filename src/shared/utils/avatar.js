import { replaceBioSymbols } from './base/string';
import { getPlatformInfo } from './avatarPlatform.js';

/**
 *
 * @param {object} args
 * @param {Map} cachedAvatarNames
 * @returns
 */
function storeAvatarImage(args, cachedAvatarNames) {
    const refCreatedAt = args.json.versions[0];
    const fileCreatedAt = refCreatedAt.created_at;
    const fileId = args.params.fileId;
    let avatarName = '';
    const imageName = args.json.name;
    const avatarNameRegex = /Avatar - (.*) - Image -/gi.exec(imageName);
    if (avatarNameRegex) {
        avatarName = replaceBioSymbols(avatarNameRegex[1]);
    }
    const ownerId = args.json.ownerId;
    const avatarInfo = {
        ownerId,
        avatarName,
        fileCreatedAt
    };
    cachedAvatarNames.set(fileId, avatarInfo);
    return avatarInfo;
}

/**
 *
 * @param {string} avatar
 * @returns {string|null}
 */
function parseAvatarUrl(avatar) {
    const url = new URL(avatar);
    const urlPath = url.pathname;
    if (urlPath.substring(5, 13) === '/avatar/') {
        const avatarId = urlPath.substring(13);
        return avatarId;
    }
    return null;
}

/**
 *
 * @param {string} unitySortNumber
 * @param sdkUnityVersion
 * @returns {boolean}
 */
function compareUnityVersion(unitySortNumber, sdkUnityVersion) {
    if (!sdkUnityVersion) {
        console.error('No sdkUnityVersion provided');
        return false;
    }

    // 2022.3.6f1  2022 03 06 000
    // 2019.4.31f1 2019 04 31 000
    // 5.3.4p1     5    03 04 010
    // 2019.4.31f1c1 is a thing
    const array = sdkUnityVersion.split('.');
    if (array.length < 3) {
        console.error('Invalid sdkUnityVersion');
        return false;
    }
    let currentUnityVersion = array[0];
    currentUnityVersion += array[1].padStart(2, '0');
    const indexFirstLetter = array[2].search(/[a-zA-Z]/);
    if (indexFirstLetter > -1) {
        currentUnityVersion += array[2]
            .substr(0, indexFirstLetter)
            .padStart(2, '0');
        currentUnityVersion += '0';
        const letter = array[2].substr(indexFirstLetter, 1);
        if (letter === 'p') {
            currentUnityVersion += '1';
        } else {
            // f
            currentUnityVersion += '0';
        }
        currentUnityVersion += '0';
    } else {
        // just in case
        currentUnityVersion += '000';
    }
    // just in case
    currentUnityVersion = currentUnityVersion.replace(/\D/g, '');

    if (parseInt(unitySortNumber, 10) <= parseInt(currentUnityVersion, 10)) {
        return true;
    }
    return false;
}

export {
    storeAvatarImage,
    parseAvatarUrl,
    getPlatformInfo,
    compareUnityVersion
};
