import {
    commands,
    type ImportPreview,
    type ImportResult,
    type ShareCollectionCreateInput,
    type ShareCollectionCreateResult
} from '@/platform/tauri/bindings';

export type {
    ImportPreview,
    ImportResult,
    ShareCollectionCreateInput,
    ShareCollectionCreateResult
};

export function createShareCollection(
    input: ShareCollectionCreateInput
): Promise<ShareCollectionCreateResult> {
    return commands.appShareCollectionCreate(input);
}

export function openShareCollectionManage(): Promise<null> {
    return commands.appShareCollectionOpenManage();
}

export function previewSharedCollection(id: string): Promise<ImportPreview> {
    return commands.appShareCollectionPreview(id);
}

export function importSharedCollection(id: string): Promise<ImportResult> {
    return commands.appShareCollectionImport(id);
}

export default Object.freeze({
    createShareCollection,
    openShareCollectionManage,
    previewSharedCollection,
    importSharedCollection
});
