import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { FILE_TABS, TAB_ORDER } from '../galleryConstants.js';
import { GalleryFileTab } from './GalleryFileTab.jsx';
import { GalleryInventoryTab } from './GalleryInventoryTab.jsx';
import { GalleryPrintsTab } from './GalleryPrintsTab.jsx';

export function GalleryTabs({
    t,
    activeTab,
    onActiveTabChange,
    tabCounts,
    fileTab,
    printsTab,
    inventoryTab
}) {
    return (
        <Tabs
            value={activeTab}
            onValueChange={onActiveTabChange}
            className="min-h-0 flex-1"
        >
            <TabsList
                variant="line"
                className="flex h-auto w-full flex-wrap justify-start"
            >
                {TAB_ORDER.map((tab) => (
                    <TabsTrigger key={tab} value={tab} className="flex-none">
                        {FILE_TABS[tab]?.titleKey
                            ? t(FILE_TABS[tab].titleKey)
                            : t(`dialog.gallery_icons.${tab}`)}
                        <span className="text-muted-foreground text-xs">
                            {tabCounts[tab]}
                        </span>
                    </TabsTrigger>
                ))}
            </TabsList>

            {Object.entries(FILE_TABS).map(([tab, definition]) => (
                <GalleryFileTab
                    key={tab}
                    t={t}
                    tab={tab}
                    definition={definition}
                    files={fileTab.assets[tab]}
                    loading={fileTab.loadingByTab[tab]}
                    uploadingTab={fileTab.uploadingTab}
                    mutatingKey={fileTab.mutatingKey}
                    isVrcPlusSupporter={fileTab.isVrcPlusSupporter}
                    currentUserId={fileTab.currentUserId}
                    profilePicOverride={fileTab.profilePicOverride}
                    userIcon={fileTab.userIcon}
                    emojiAnimType={fileTab.emojiAnimType}
                    emojiAnimationStyle={fileTab.emojiAnimationStyle}
                    emojiAnimFps={fileTab.emojiAnimFps}
                    emojiAnimFrameCount={fileTab.emojiAnimFrameCount}
                    emojiAnimLoopPingPong={fileTab.emojiAnimLoopPingPong}
                    onRefresh={fileTab.onRefresh}
                    onBeginUpload={fileTab.onBeginUpload}
                    onClearProfileField={fileTab.onClearProfileField}
                    onEmojiAnimTypeChange={fileTab.onEmojiAnimTypeChange}
                    onEmojiAnimationStyleChange={
                        fileTab.onEmojiAnimationStyleChange
                    }
                    onEmojiAnimFpsChange={fileTab.onEmojiAnimFpsChange}
                    onEmojiAnimFrameCountChange={
                        fileTab.onEmojiAnimFrameCountChange
                    }
                    onEmojiAnimLoopPingPongChange={
                        fileTab.onEmojiAnimLoopPingPongChange
                    }
                    onCreateAnimatedEmoji={fileTab.onCreateAnimatedEmoji}
                    onPreview={fileTab.onPreview}
                    onSetProfileField={fileTab.onSetProfileField}
                    onDeleteFile={fileTab.onDeleteFile}
                />
            ))}
            <GalleryPrintsTab t={t} {...printsTab} />
            <GalleryInventoryTab t={t} {...inventoryTab} />
        </Tabs>
    );
}
