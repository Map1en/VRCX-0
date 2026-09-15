import { getPlatformInfo } from './avatarPlatform';
import { replaceBioSymbols } from './string';

interface AvatarImageMetadataInput {
    versions: Array<{ created_at?: string }>;
    name?: string;
    ownerId?: string;
}

interface AvatarImageMetadata {
    ownerId?: string;
    avatarName: string;
    fileCreatedAt?: string;
}

function parseAvatarImageMetadata(
    input: AvatarImageMetadataInput
): AvatarImageMetadata {
    const refCreatedAt = input.versions[0];
    const fileCreatedAt = refCreatedAt.created_at;
    let avatarName = '';
    const imageName = input.name;
    const avatarNameRegex = imageName
        ? /Avatar - (.*) - Image -/gi.exec(imageName)
        : null;
    if (avatarNameRegex) {
        avatarName = replaceBioSymbols(avatarNameRegex[1]);
    }
    const ownerId = input.ownerId;
    return {
        ownerId,
        avatarName,
        fileCreatedAt
    };
}

const DEFAULT_AVATAR_FILE_ID = 'file_0e8c4e32-7444-44ea-ade4-313c010d4bae';

function stripDefaultAvatarImage<T extends Record<string, unknown>>(
    record: T
): T {
    const imageUrl = record['currentAvatarImageUrl'];
    if (
        typeof imageUrl === 'string' &&
        imageUrl.includes(DEFAULT_AVATAR_FILE_ID)
    ) {
        Object.assign(record, {
            currentAvatarImageUrl: '',
            currentAvatarThumbnailImageUrl: ''
        });
    }
    return record;
}

function parseAvatarUrl(avatar: string): string | null {
    const url = new URL(avatar);
    const urlPath = url.pathname;
    if (urlPath.substring(5, 13) === '/avatar/') {
        const avatarId = urlPath.substring(13);
        return avatarId;
    }
    return null;
}

function compareUnityVersion(
    unitySortNumber: string,
    sdkUnityVersion: string
): boolean {
    if (!sdkUnityVersion) {
        console.error('No sdkUnityVersion provided');
        return false;
    }

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
            currentUnityVersion += '0';
        }
        currentUnityVersion += '0';
    } else {
        currentUnityVersion += '000';
    }
    currentUnityVersion = currentUnityVersion.replace(/\D/g, '');

    if (parseInt(unitySortNumber, 10) <= parseInt(currentUnityVersion, 10)) {
        return true;
    }
    return false;
}

export {
    parseAvatarImageMetadata,
    stripDefaultAvatarImage,
    parseAvatarUrl,
    getPlatformInfo,
    compareUnityVersion
};
