import {
    commands,
    type ImportPreview,
    type ShareCollectionCreateInput,
    type ShareCollectionCreateResult
} from '@/platform/tauri/bindings';

export type {
    ImportPreview,
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

export default Object.freeze({
    createShareCollection,
    openShareCollectionManage,
    previewSharedCollection
});
