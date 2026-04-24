import { ArrowLeftIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location.jsx';
import { openUserDialog } from '@/services/dialogService.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';

import {
    formatScreenshotBytes,
    formatScreenshotDateTime
} from '../screenshotMetadataValues.js';
import { EmptyState, MetadataAuthorLink } from './ScreenshotMetadataParts.jsx';

export function ScreenshotMetadataDetailsCard({
    metadata,
    metadataError,
    searchRowsCount,
    currentEndpoint,
    onBackToResults
}) {
    const { t } = useTranslation();

    return (
        <Card className="flex min-h-0 flex-col">
            <CardHeader>
                <CardTitle>{t('view.tools.generated.details')}</CardTitle>
                <CardDescription>
                    {t(
                        'view.tools.generated.metadata_extracted_from_the_selected_vrchat_screenshot'
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 overflow-y-auto">
                {searchRowsCount ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mb-2"
                        onClick={onBackToResults}
                    >
                        <ArrowLeftIcon data-icon="inline-start" />
                        {t('dialog.screenshot_metadata.back_to_results', {
                            count: searchRowsCount
                        })}
                    </Button>
                ) : null}
                {metadataError ? (
                    <pre className="text-muted-foreground text-xs whitespace-pre-wrap">
                        {metadataError}
                    </pre>
                ) : metadata ? (
                    <>
                        <section className="flex flex-col gap-2">
                            <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                {t(
                                    'dialog.screenshot_metadata.section_location'
                                )}
                            </div>
                            {metadata.world?.instanceId ||
                            metadata.world?.id ? (
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
                            <MetadataAuthorLink
                                author={metadata.author}
                                endpoint={currentEndpoint}
                            />
                        </section>

                        <section className="flex flex-col gap-2 border-t pt-4">
                            <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                {t(
                                    'dialog.screenshot_metadata.section_players'
                                )}{' '}
                                ({metadata.players.length})
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
                                                <UsersIcon data-icon="inline-start" />
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
                                    {t(
                                        'view.tools.generated.no_player_metadata'
                                    )}
                                </div>
                            )}
                        </section>

                        <section className="flex flex-col gap-2 border-t pt-4">
                            <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                {t(
                                    'dialog.screenshot_metadata.section_file_info'
                                )}
                            </div>
                            <div className="text-sm">
                                {formatScreenshotDateTime(metadata.dateTime)}
                            </div>
                            <div className="text-muted-foreground text-sm">
                                {[
                                    metadata.resolution,
                                    formatScreenshotBytes(
                                        metadata.fileSizeBytes
                                    )
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
                                    {t(
                                        'dialog.screenshot_metadata.section_note'
                                    )}
                                </div>
                                <div className="text-muted-foreground text-sm">
                                    {metadata.note}
                                </div>
                            </section>
                        ) : null}

                        {metadata.application ? (
                            <section className="flex flex-col gap-2 border-t pt-4">
                                <div className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
                                    {t(
                                        'view.settings.general.application.header'
                                    )}
                                </div>
                                <div className="text-muted-foreground text-sm">
                                    {metadata.application}
                                </div>
                            </section>
                        ) : null}
                    </>
                ) : (
                    <EmptyState
                        title={t('view.tools.generated.no_screenshot_selected')}
                        description={t(
                            'view.tools.generated.load_a_screenshot_to_inspect_embedded_world_player_and_file_'
                        )}
                    />
                )}
            </CardContent>
        </Card>
    );
}
