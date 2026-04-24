import {
    RefreshCwIcon,
    UploadIcon,
    XIcon
} from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';

import { TabsContent } from '@/ui/shadcn/tabs';
import { GalleryEmojiUploadSettings } from './GalleryEmojiUploadSettings.jsx';
import { GalleryFileCard } from './GalleryFileCard.jsx';
import { EmptyState, LoadingState } from './GalleryViewParts.jsx';

export function GalleryFileTab({
    t,
    tab,
    definition,
    files,
    loading,
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
}) {
    return (
        <TabsContent value={tab} className="min-h-0">
            <Card>
                <CardHeader className="gap-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <CardTitle>{t(definition.titleKey)}</CardTitle>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
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
                                    !isVrcPlusSupporter ||
                                    Boolean(uploadingTab)
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
                                    {t('dialog.gallery_icons.clear')}
                                </Button>
                            ) : null}
                            {tab === 'icons' ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!userIcon || Boolean(mutatingKey)}
                                    onClick={() =>
                                        onClearProfileField('userIcon', '')
                                    }
                                >
                                    <XIcon data-icon="inline-start" />
                                    {t('dialog.gallery_icons.clear')}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    {tab === 'emojis' ? (
                        <GalleryEmojiUploadSettings
                            t={t}
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
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <LoadingState />
                    ) : files.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {files.map((file) => (
                                <GalleryFileCard
                                    key={file.id}
                                    t={t}
                                    tab={tab}
                                    definition={definition}
                                    file={file}
                                    profilePicOverride={profilePicOverride}
                                    userIcon={userIcon}
                                    mutatingKey={mutatingKey}
                                    isVrcPlusSupporter={isVrcPlusSupporter}
                                    currentUserId={currentUserId}
                                    onPreview={onPreview}
                                    onSetProfileField={onSetProfileField}
                                    onDeleteFile={onDeleteFile}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            title={t(
                                'view.tools.generated_dynamic.no_value_loaded',
                                { value: tab }
                            )}
                            description={t(
                                'view.tools.generated_dynamic.refresh_this_tab_to_load_value_files',
                                { value: definition.tag }
                            )}
                        />
                    )}
                </CardContent>
            </Card>
        </TabsContent>
    );
}
