import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';

export function LoginPageFooter({ onOpenGithub, onOpenDiscord }) {
    const { t } = useTranslation();

    return (
        <div className="text-muted-foreground/65 mt-4 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 text-center text-[0.7rem]">
            <div className="flex justify-end">
                <Button
                    type="button"
                    variant="link"
                    className="text-muted-foreground/75 h-auto p-0 text-[0.7rem]"
                    onClick={onOpenGithub}
                >
                    {t('view.login.footer.github')}
                </Button>
            </div>
            <span aria-hidden="true">|</span>
            <div className="flex justify-start">
                <Button
                    type="button"
                    variant="link"
                    className="text-muted-foreground/75 h-auto p-0 text-[0.7rem]"
                    onClick={onOpenDiscord}
                >
                    {t('view.login.footer.discord')}
                </Button>
            </div>
            <span className="justify-self-end">
                {t('view.login.footer.builtForPlayers')}
            </span>
            <span aria-hidden="true">|</span>
            <span className="justify-self-start">
                {t('view.login.footer.deviceStorage')}
            </span>
        </div>
    );
}
