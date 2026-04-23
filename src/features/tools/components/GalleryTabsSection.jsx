import { GalleryTabs } from './GalleryTabs.jsx';

export function GalleryTabsSection({ handlers, state, t }) {
    const {
        activeTab,
        assets,
        currentUserId,
        emojiAnimFps,
        emojiAnimFrameCount,
        emojiAnimLoopPingPong,
        emojiAnimationStyle,
        emojiAnimType,
        isVrcPlusSupporter,
        loadingByTab,
        mutatingKey,
        printCropBorder,
        printUploadNote,
        profilePicOverride,
        tabCounts,
        uploadingTab,
        userIcon
    } = state;
    const {
        onActiveTabChange,
        onBeginUpload,
        onClearProfileField,
        onConsumeBundle,
        onCreateAnimatedEmoji,
        onDeleteFile,
        onDeletePrint,
        onEmojiAnimationStyleChange,
        onEmojiAnimFpsChange,
        onEmojiAnimFrameCountChange,
        onEmojiAnimLoopPingPongChange,
        onEmojiAnimTypeChange,
        onPreview,
        onPrintCropBorderChange,
        onPrintUploadNoteChange,
        onRedeem,
        onRefresh,
        onSetProfileField
    } = handlers;

    return (
        <GalleryTabs
            t={t}
            activeTab={activeTab}
            onActiveTabChange={onActiveTabChange}
            tabCounts={tabCounts}
            fileTab={{
                assets,
                loadingByTab,
                uploadingTab,
                mutatingKey,
                isVrcPlusSupporter,
                currentUserId,
                profilePicOverride,
                userIcon,
                emojiAnimType,
                emojiAnimationStyle,
                emojiAnimFps,
                emojiAnimFrameCount,
                emojiAnimLoopPingPong,
                onRefresh,
                onBeginUpload,
                onClearProfileField,
                onEmojiAnimTypeChange,
                onEmojiAnimationStyleChange,
                onEmojiAnimFpsChange,
                onEmojiAnimFrameCountChange,
                onEmojiAnimLoopPingPongChange,
                onCreateAnimatedEmoji,
                onPreview,
                onSetProfileField,
                onDeleteFile
            }}
            printsTab={{
                prints: assets.prints,
                loading: loadingByTab.prints,
                uploadingTab,
                mutatingKey,
                isVrcPlusSupporter,
                printUploadNote,
                printCropBorder,
                onRefresh,
                onBeginUpload,
                onPrintUploadNoteChange,
                onPrintCropBorderChange,
                onPreview,
                onDeletePrint
            }}
            inventoryTab={{
                items: assets.inventory,
                loading: loadingByTab.inventory,
                mutatingKey,
                onRefresh,
                onRedeem,
                onPreview,
                onConsumeBundle
            }}
        />
    );
}
