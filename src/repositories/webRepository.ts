import { backend } from '../platform/tauri/index.js';

async function clearCookies(): Promise<unknown> {
    return backend.web.clearCookies();
}

async function getCookies(): Promise<unknown> {
    return backend.web.getCookies();
}

async function setCookies(cookie: unknown): Promise<unknown> {
    return backend.web.setCookies(cookie);
}

const webRepository = Object.freeze({
    clearCookies,
    getCookies,
    setCookies
});

export { clearCookies, getCookies, setCookies };
export default webRepository;
