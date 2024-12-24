require('dotenv').config();
const validateDatabaseConnection = require('./services/postgres.db.service');
const googleService = require('./services/google.service');
const etlService = require('./services/etl.service');
const syncQueue = require('./services/queue');
const fileProcessor = require('./services/queue/processor');
const EventEmitter = require('events');

class BackgroundService extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.processInterval = null;
    }

    async waitForGoogleSettings() {
        return new Promise((resolve) => {
            const checkSettings = async () => {
                const initialized = await googleService.initialize();
                if (initialized) {
                    if (this.configCheckInterval) {
                        clearInterval(this.configCheckInterval);
                    }
                    resolve(true);
                }
            };

            checkSettings();

            this.configCheckInterval = setInterval(checkSettings, 10000);
        });
    }

    async start() {
        try {
            const isDbConnected = await validateDatabaseConnection();
            if (!isDbConnected) {
                throw new Error('Database connection failed');
            }
            console.log('Database connected successfully');

            syncQueue.setProcessor(fileProcessor);

            console.log('Waiting for Google settings...');
            await this.waitForGoogleSettings();
            console.log('Google service configured from DB');

            await etlService.initialize();
            console.log('ETL Service initialized in standby mode');

            googleService.on('authenticated', async (auth) => {
                console.log('Received authentication update');
                etlService.setAuth(auth);
                syncQueue.setInitialized(true);
                await this.startProcessing();
                console.log('Services activated with auth');
            });

            const setupNeeded = await googleService.requiresSetup();
            if (!setupNeeded) {
                console.log('Using existing Google authentication');
                etlService.setAuth(googleService.getAuth());
                syncQueue.setInitialized(true);
                await this.startProcessing();
                console.log('Services fully initialized with existing auth');
            }

            this.startHeartbeat();

            this.setupShutdownHandlers();

        } catch (error) {
            console.error('Failed to start background service:', error);
            throw error;
        }
    }

    async startProcessing() {
        try {
            await etlService.startPeriodicSync();
            console.log('ETL processing started');
        } catch (error) {
            console.error('Error starting processing:', error);
        }
    }

    startHeartbeat() {
        this.isRunning = true;
        this.processInterval = setInterval(() => {
            if (this.isRunning) {
                console.log('Background service running...', new Date().toISOString());
            }
        }, 60000);
    }

    setupShutdownHandlers() {
        const shutdown = async () => {
            console.log('Shutting down background service...');
            this.isRunning = false;

            if (this.processInterval) {
                clearInterval(this.processInterval);
            }

            if (this.configCheckInterval) {
                clearInterval(this.configCheckInterval);
            }

            try {
                if (etlService.authCheckInterval) {
                    clearInterval(etlService.authCheckInterval);
                }

                syncQueue.stopMonitoring();

                console.log('Background service stopped successfully');
                process.exit(0);
            } catch (error) {
                console.error('Error during shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}

const backgroundService = new BackgroundService();
backgroundService.start().catch(error => {
    console.error('Fatal error during background service startup:', error);
    process.exit(1);
});