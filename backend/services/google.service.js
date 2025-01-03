const { google } = require('googleapis');
const path = require('path');
const fs = require('fs').promises;
const systemSettingsService = require('./system-settings.service');
const BaseService = require('./base.service');

class GoogleService extends BaseService {
    constructor() {
        super();
        this.auth = null;
        this.drive = null;
        this.isAuthenticated = false;
        this.configurationPromise = null;
        this.configResolver = null;
    }

    async waitForConfiguration() {
        const isInitialized = await this.initialize();
        if (isInitialized) return true;

        if (!this.configurationPromise) {
            this.configurationPromise = new Promise(resolve => {
                this.configResolver = resolve;

                const checkInterval = setInterval(async () => {
                    const initialized = await this.initialize();
                    if (initialized) {
                        clearInterval(checkInterval);
                        resolve(true);
                    }
                }, 2000);
            });
        }

        return this.configurationPromise;
    }


    async initialize() {
        try {
            const settings = await systemSettingsService.get('google');
            if (!settings?.value) {
                return false;
            }

            const { clientId, clientSecret, redirectUri } = settings.value;
            this.auth = new google.auth.OAuth2(
                clientId,
                clientSecret,
                redirectUri || "http://localhost:3000/auth/google/callback"
            );

            this.drive = google.drive({ version: 'v3', auth: this.auth });

            this.auth.on('tokens', async (tokens) => {
                if (tokens.refresh_token || tokens.access_token) {
                    const currentTokens = await this.loadTokensFromSettings();
                    const mergedTokens = {
                        ...currentTokens,
                        ...tokens,
                        access_token: tokens.access_token || currentTokens?.access_token,
                        refresh_token: tokens.refresh_token || currentTokens?.refresh_token,
                        expiry_date: tokens.expiry_date || currentTokens?.expiry_date
                    };
                    await this.saveTokensToSettings(mergedTokens);
                }
                this.emit('tokensUpdated', tokens);
            });

            await this.verifyAndInitializeAuth();
            this.markInitialized();

            return true;
        } catch (error) {
            console.error('Failed to initialize Google service:');
            return false;
        }
    }

    async verifyAndInitializeAuth() {
        try {
            const loaded = await this.loadSavedTokens();

            if (loaded && this.auth.credentials) {
                try {
                    await this.drive.files.list({ pageSize: 1 });
                    this.isAuthenticated = true;
                    this.emit('authenticated', this.auth);
                    return true;
                } catch (apiError) {
                    await systemSettingsService.update('google_tokens', null);
                    this.isAuthenticated = false;
                    this.emit('authenticationFailed', apiError);
                    this.emit('authenticationRequired');
                    return false;
                }
            }

            console.log('No valid credentials found, authentication required');
            this.emit('authenticationRequired');
            return false;
        } catch (error) {
            console.error('Error verifying authentication:');
            this.emit('authenticationFailed');
            return false;
        }
    }

    async loadTokensFromSettings() {
        try {
            const setting = await systemSettingsService.get('google_tokens');
            return setting?.value || null;
        } catch (error) {
            console.error('Error loading tokens from settings:');
            return null;
        }
    }

    async saveTokensToSettings(tokens) {
        try {
            await systemSettingsService.update('google_tokens', tokens);
        } catch (error) {
            console.error('Error saving tokens to settings:');
            throw error;
        }
    }

    async loadSavedTokens() {
        try {
            const tokens = await this.loadTokensFromSettings();
            if (!tokens) {
                this.isAuthenticated = false;
                return false;
            }

            const expiryDate = new Date(tokens.expiry_date);
            const now = new Date();

            if (now >= expiryDate && tokens.refresh_token) {
                try {
                    const refreshedTokens = await this.auth.refreshToken(tokens.refresh_token);
                    const mergedTokens = {
                        ...tokens,
                        ...refreshedTokens.tokens,
                        refresh_token: tokens.refresh_token
                    };
                    await this.saveTokensToSettings(mergedTokens);
                    this.auth.setCredentials(mergedTokens);
                    this.isAuthenticated = true;
                    this.emit('authenticated', this.auth);
                    return true;
                } catch (refreshError) {
                    this.isAuthenticated = false;
                    return false;
                }
            } else {
                this.auth.setCredentials(tokens);
                this.isAuthenticated = true;
                this.emit('authenticated', this.auth);
                return true;
            }
        } catch (error) {
            this.isAuthenticated = false;
            return false;
        }
    }

    async setCredentials(code) {
        try {
            const { tokens } = await this.auth.getToken(code);

            const existingTokens = await this.loadTokensFromSettings();

            const mergedTokens = {
                ...existingTokens,
                ...tokens,
                refresh_token: tokens.refresh_token || existingTokens?.refresh_token
            };

            this.auth.setCredentials(mergedTokens);

            await this.saveTokensToSettings(mergedTokens);

            this.isAuthenticated = true;
            this.emit('authenticated', this.auth);

            return mergedTokens;
        } catch (error) {
            console.error('Error setting credentials:');
            this.isAuthenticated = false;
            throw error;
        }
    }


    async getAuthUrl() {
        if (!this.auth) {
            const settings = await systemSettingsService.get('google');
            if (!settings?.value) {
                throw new Error('Google service not configured yet - waiting for settings - this my take up to a minte');
            }

            const { clientId, clientSecret, redirectUri } = settings.value;
            const auth = new google.auth.OAuth2(
                clientId,
                clientSecret,
                redirectUri || "http://localhost:3000/auth/google/callback"
            );
            this.auth = auth;
        }

        return this.auth.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'
            ]
        });
    }

    async getFileContent(fileId) {
        try {
            const response = await this.drive.files.export({
                fileId: fileId,
                mimeType: 'text/plain'
            });

            return response;
        } catch (error) {
            console.error('Error getting file content:');
            throw error;
        }
    }

    async requiresSetup() {
        await this.waitForInit();
        if (!this.isAuthenticated) return 'authentication';
        return null;
    }

    getAuth() {
        return this.auth;
    }

    async listFiles({ pageSize, nextPageToken = null, query = null, filters = null }) {
        await this.waitForInit();
        try {
            let queryString = '';

            if (filters?.modifiedTime) {
                queryString += `modifiedTime > '${new Date(filters.modifiedTime).toISOString()}'`;
            }

            if (query) {
                queryString += queryString ? ` and ${query}` : query;
            }

            const params = {
                pageSize,
                pageToken: nextPageToken,
                fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, owners, size)',
                orderBy: 'modifiedTime desc',
                q: queryString || undefined
            };

            const response = await this.drive.files.list(params);
            return {
                files: response.data.files,
                nextPageToken: response.data.nextPageToken,
                hasMore: !!response.data.nextPageToken,
            };
        } catch (error) {
            console.error('Error listing files:');
            throw error;
        }
    }

    async getFile(fileId) {
        await this.waitForInit();
        try {
            const response = await this.drive.files.get({ fileId });
            return response.data;
        } catch (error) {
            console.error('Error getting file:');
            throw error;
        }
    }
}

const googleService = new GoogleService();
module.exports = googleService;