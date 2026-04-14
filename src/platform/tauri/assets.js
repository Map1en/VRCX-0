import { convertFileSrc as tauriConvertFileSrc } from '@tauri-apps/api/core';

export function convertFileSrc(filePath, protocol = 'asset') {
    return tauriConvertFileSrc(filePath, protocol);
}
