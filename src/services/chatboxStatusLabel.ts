import type { ChatboxStatus } from '@/platform/tauri/bindings';

export function chatboxStatusLabelKey(status: ChatboxStatus): string {
    if (status.pauseReason === 'isolated') {
        return 'view.tools.chatbox.status.isolated';
    }
    if (status.pauseReason === 'gameNotRunning') {
        return 'view.tools.chatbox.status.game_not_running';
    }
    switch (status.activity) {
        case 'off':
            return 'view.tools.chatbox.status.off';
        case 'status':
            return 'view.tools.chatbox.status.showing';
        case 'manual':
            return 'view.tools.chatbox.status.manual';
        case 'afk':
            return 'view.tools.chatbox.status.afk';
    }
}
