import { UserIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { formatScreenshotDateTime } from '@/lib/dateTime';
import { openUserDialog } from '@/services/dialogService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import { formatScreenshotBytes } from '../screenshotMetadataValues';
import type { NormalizedScreenshotMetadata } from '../screenshotMetadataValues';
import { EmptyState, MetadataAuthorLink } from './ScreenshotMetadataParts';

export function ScreenshotMetadataDetailsCard({
    metadata,
    metadataError
}: {
    metadata: NormalizedScreenshotMetadata | null;
    metadataError: string;
}) {
    const { i18n, t } = useTranslation();
    const dateLocale = i18n.resolvedLanguage || i18n.language;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            {metadataError ? (
                <pre className="text-muted-foreground text-xs whitespace-pre-wrap">
                    {metadataError}
                </pre>
            ) : metadata ? (
                <>
                    <section className="flex flex-col gap-2">
                        <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                            {t('dialog.screenshot_metadata.section_location')}
                        </div>
                        {metadata.world?.instanceId || metadata.world?.id ? (
                            <Location
                                location={
                                    metadata.world?.instanceId ||
                                    metadata.world?.id
                                }
                                hint={metadata.world?.name || ''}
                                enableContextMenu
                                showLaunchActions
                            />
                        ) : (
                            <div className="text-sm">
                                {metadata.world?.name || '\u2014'}
                            </div>
                        )}
                        <MetadataAuthorLink author={metadata.author} />
                    </section>

                    <section className="flex flex-col gap-2 border-t pt-4">
                        <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                            {t('dialog.screenshot_metadata.section_players')} (
                            {metadata.players.length})
                        </div>
                        {metadata.players.length ? (
                            <div className="flex flex-wrap gap-2">
                                {metadata.players.map((player) => {
                                    const playerLabel =
                                        player.displayName ||
                                        player.id ||
                                        t(
                                            'dialog.screenshot_metadata.unknown_player'
                                        );
                                    const playerContent = (
                                        <>
                                            <UserIcon data-icon="inline-start" />
                                            {playerLabel}
                                        </>
                                    );

                                    return player.id ? (
                                        <Button
                                            key={`${player.id}-${player.displayName}`}
                                            variant="secondary"
                                            size="xs"
                                            type="button"
                                            className="rounded-full"
                                            onClick={() =>
                                                openUserDialog({
                                                    userId: player.id,
                                                    title: playerLabel
                                                })
                                            }
                                        >
                                            {playerContent}
                                        </Button>
                                    ) : (
                                        <Badge
                                            key={`${player.id}-${player.displayName}`}
                                            variant="secondary"
                                        >
                                            {playerContent}
                                        </Badge>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-muted-foreground text-sm">
                                {t('view.tools.empty.no_player_metadata')}
                            </div>
                        )}
                    </section>

                    <section className="flex flex-col gap-2 border-t pt-4">
                        <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                            {t('dialog.screenshot_metadata.section_file_info')}
                        </div>
                        <div className="text-sm">
                            {formatScreenshotDateTime(
                                metadata.dateTime,
                                dateLocale
                            )}
                        </div>
                        <div className="text-muted-foreground text-sm">
                            {[
                                metadata.resolution,
                                formatScreenshotBytes(metadata.fileSizeBytes)
                            ]
                                .filter(Boolean)
                                .join(' \u00b7 ') || '\u2014'}
                        </div>
                        <div className="text-muted-foreground text-xs break-all">
                            {metadata.fileName || metadata.filePath}
                        </div>
                    </section>

                    {metadata.note ? (
                        <section className="flex flex-col gap-2 border-t pt-4">
                            <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                {t('dialog.screenshot_metadata.section_note')}
                            </div>
                            <div className="text-muted-foreground text-sm">
                                {metadata.note}
                            </div>
                        </section>
                    ) : null}

                    {metadata.application ? (
                        <section className="flex flex-col gap-2 border-t pt-4">
                            <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                {t('dialog.screenshot_metadata.source')}
                            </div>
                            <div className="text-muted-foreground text-sm">
                                {metadata.application}
                            </div>
                        </section>
                    ) : null}
                </>
            ) : (
                <EmptyState
                    title={t('view.tools.empty.no_screenshot_selected')}
                    description={t(
                        'view.tools.action.load_a_screenshot_to_inspect_embedded_world_player_and_file_metadata'
                    )}
                />
            )}
        </div>
    );
}
