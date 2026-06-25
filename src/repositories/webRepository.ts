import { commands } from '@/platform/tauri/bindings';

async function clearCookies(): Promise<unknown> {
    return commands.webClearCookies();
}

async function clearAuthCookies(): Promise<unknown> {
    return commands.webClearAuthCookies();
}

const webRepository = Object.freeze({
    clearCookies,
    clearAuthCookies
});

export { clearCookies, clearAuthCookies };
export default webRepository;
