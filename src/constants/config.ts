// Base URL of the PHP API server.
// For local XAMPP: use the machine's LAN IP so the Android tablet can reach it.
// Example: 'http://192.168.1.100/POS'
export const API_BASE_URL = 'http://192.168.1.100/POS';

export const API_TIMEOUT_MS = 10_000;

// JWT token key in SecureStore
export const TOKEN_KEY = 'smartbrew_token';
export const USER_KEY  = 'smartbrew_user';

// Offline queue settings
export const MAX_SYNC_RETRIES = 5;
export const SYNC_INTERVAL_MS = 30_000;

// Printer
export const PRINTER_PORT    = 9100;
export const PRINTER_TIMEOUT = 5_000;
export const PAPER_WIDTH_CHARS = 48;
