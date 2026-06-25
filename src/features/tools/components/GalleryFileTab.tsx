import { RefreshCwIcon, UploadIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { TabsContent } from '@/ui/shadcn/tabs';

import { GalleryEmojiUploadSettings } from './GalleryEmojiUploadSettings';
import { GalleryFileCard } from './GalleryFileCard';
import { EmptyState, LoadingState } from './GalleryViewParts';
import { MediaLibraryToolbar } from './MediaLibraryToolbar';

export function GalleryFileTab({ tab, definition, fileTab }: any) {
    const {
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
        gridDensityConfig,
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
    } = fileTab;
    const files = assets[tab];
    const loading = loadingByTab[tab];
    const { t } = useTranslation();

    return (
        <TabsContent
            value={tab}
            className="mt-2 min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
        >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <MediaLibraryToolbar
                    actions={
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onRefresh(tab)}
                            >
                                <RefreshCwIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.refresh')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={
                                    !isVrcPlusSupporter || Boolean(uploadingTab)
                                }
                                onClick={() => onBeginUpload(tab)}
                            >
                                <UploadIcon data-icon="inline-start" />
                                {t('dialog.gallery_icons.upload')}
                            </Button>
                            {tab === 'gallery' ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                        !isVrcPlusSupporter ||
                                        !profilePicOverride ||
                                        Boolean(mutatingKey)
                                    }
                                    onClick={() =>
                                        onClearProfileField(
                                            'profilePicOverride',
                                            ''
                                        )
                                    }
                                >
                                    <XIcon data-icon="inline-start" />
                                    {t('dialog.gallery_icons.clear_banner')}
                                </Button>
                            ) : null}
                            {tab === 'icons' ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                        !isVrcPlusSupporter ||
                                        !userIcon ||
                                        Boolean(mutatingKey)
                                    }
                                    onClick={() =>
                                        onClearProfileField('userIcon', '')
                                    }
                                >
                                    <XIcon data-icon="inline-start" />
                                    {t(
                                        'dialog.gallery_icons.clear_profile_icon'
                                    )}
                                </Button>
                            ) : null}
                        </>
                    }
                >
                    {tab === 'emojis' ? (
                        <GalleryEmojiUploadSettings
                            emojiAnimType={emojiAnimType}
                            emojiAnimationStyle={emojiAnimationStyle}
                            emojiAnimFps={emojiAnimFps}
                            emojiAnimFrameCount={emojiAnimFrameCount}
                            emojiAnimLoopPingPong={emojiAnimLoopPingPong}
                            onEmojiAnimTypeChange={onEmojiAnimTypeChange}
                            onEmojiAnimationStyleChange={
                                onEmojiAnimationStyleChange
                            }
                            onEmojiAnimFpsChange={onEmojiAnimFpsChange}
                            onEmojiAnimFrameCountChange={
                                onEmojiAnimFrameCountChange
                            }
                            onEmojiAnimLoopPingPongChange={
                                onEmojiAnimLoopPingPongChange
                            }
                            onCreateAnimatedEmoji={onCreateAnimatedEmoji}
                        />
                    ) : null}
                </MediaLibraryToolbar>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {loading ? (
                        <LoadingState />
                    ) : files.length > 0 ? (
                        <div
                            className={`${gridDensityConfig.fileGridClass} p-1`}
                        >
                            {files.map((file: any) => (
                                <GalleryFileCard
                                    key={file.id}
                                    tab={tab}
                                    definition={definition}
                                    file={file}
                                    profilePicOverride={profilePicOverride}
                                    userIcon={userIcon}
                                    mutatingKey={mutatingKey}
                                    isVrcPlusSupporter={isVrcPlusSupporter}
                                    currentUserId={currentUserId}
                                    densityConfig={gridDensityConfig}
                                    onPreview={onPreview}
                                    onSetProfileField={onSetProfileField}
                                    onDeleteFile={onDeleteFile}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            title={t('view.tools.dynamic.no_value_loaded', {
                                value: tab
                            })}
                            description={t(
                                'view.tools.dynamic.refresh_this_tab_to_load_value_files',
                                { value: definition.tag }
                            )}
                        />
                    )}
                </div>
            </div>
        </TabsContent>
    );
}
