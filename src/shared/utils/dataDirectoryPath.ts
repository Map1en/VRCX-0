const WINDOWS_EXTENDED_PATH_PREFIX = '\\\\?\\';
const WINDOWS_EXTENDED_UNC_PATH_PREFIX = `${WINDOWS_EXTENDED_PATH_PREFIX}UNC\\`;

export function dataDirectoryPathForDisplay(value?: string | null) {
    if (!value) {
        return '-';
    }
    if (value.startsWith(WINDOWS_EXTENDED_UNC_PATH_PREFIX)) {
        return `\\\\${value.slice(WINDOWS_EXTENDED_UNC_PATH_PREFIX.length)}`;
    }
    if (value.startsWith(WINDOWS_EXTENDED_PATH_PREFIX)) {
        return value.slice(WINDOWS_EXTENDED_PATH_PREFIX.length);
    }
    return value;
}
