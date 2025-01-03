const OpenAI = require('openai');
const systemSettingsService = require('../system-settings.service');
const EventEmitter = require('events');

class BaseOpenAIService extends EventEmitter {
    constructor(apiKey = null) {
        super();
        this.openai = null;
        this.systemPrompt = '';
        this.isConfigured = false;
        this.configurationPromise = null;
        this.configResolver = null;
        this.apiKEY = apiKey;
        this.initialize();
    }

    async waitForConfiguration() {
        if (this.isConfigured) return true;

        if (!this.configurationPromise) {
            this.configurationPromise = new Promise(resolve => {
                this.configResolver = resolve;
            });
        }

        return this.configurationPromise;
    }

    async initialize() {
        try {
            const settings = await systemSettingsService.get("openai");
            if (settings?.value) {
                const keys = Object.keys(settings.value);
                const key = settings.value[this.apiKEY] || settings.value[keys[0]];

                this.openai = new OpenAI({
                    apiKey: key,
                });

                this.isConfigured = true;
                if (this.configResolver) {
                    this.configResolver(true);
                }

                return true;
            }

            console.log('Waiting for OpenAI API key to be configured...');
            return false;


        } catch (error) {
            console.error('Failed to initialize OpenAI:');
            return false;
        }
    }

    async ensureInitialized() {
        if (!this.isConfigured) {
            const initialized = await this.initialize();
            if (!initialized) {
                await this.waitForConfiguration();
                await this.initialize();
            }
        }

        if (!this.openai) {
            throw new Error('OpenAI client not properly initialized');
        }
    }

    async requiresConfiguration() {
        return !this.isConfigured;
    }

    async reinitialize() {
        this.openai = null;
        this.isConfigured = false;
        this.configurationPromise = null;
        this.configResolver = null;
        return this.initialize();
    }

    async generateQuery(params) {
        throw new Error('generateQuery method must be implemented by child class');
    }

    async createChatCompletion(messages, model = 'gpt-3.5-turbo') {
        await this.ensureInitialized();
        return this.openai.chat.completions.create({
            model,
            messages,
        });
    }
}

module.exports = BaseOpenAIService;