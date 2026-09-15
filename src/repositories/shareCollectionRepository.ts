import {
    commands,
    type ImportPreview,
    type ShareCollectionCreateInput,
    type ShareCollectionCreateResult
} from '@/platform/tauri/bindings';

export type { ShareCollectionCreateResult };

function createShareCollection(
    input: ShareCollectionCreateInput
): Promise<ShareCollectionCreateResult> {
    return commands.appShareCollectionCreate(input);
}

function openShareCollectionManage(): Promise<null> {
    return commands.appShareCollectionOpenManage();
}

function previewSharedCollection(id: string): Promise<ImportPreview> {
    return commands.appShareCollectionPreview(id);
}

export default Object.freeze({
    createShareCollection,
    openShareCollectionManage,
    previewSharedCollection
});
