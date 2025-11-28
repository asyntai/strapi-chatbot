import type { Core } from '@strapi/strapi';

interface AsyntaiSettings {
  site_id: string;
  script_url: string;
  account_email: string;
}

const DEFAULT_SETTINGS: AsyntaiSettings = {
  site_id: '',
  script_url: 'https://asyntai.com/static/js/chat-widget.js',
  account_email: '',
};

const settingsService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getSettings(): Promise<AsyntaiSettings> {
    const pluginStore = strapi.store({
      type: 'plugin',
      name: 'asyntai-chatbot',
    });

    const settings = await pluginStore.get({ key: 'settings' }) as AsyntaiSettings | null;

    return {
      site_id: settings?.site_id || DEFAULT_SETTINGS.site_id,
      script_url: settings?.script_url || DEFAULT_SETTINGS.script_url,
      account_email: settings?.account_email || DEFAULT_SETTINGS.account_email,
    };
  },

  async setSettings(data: Partial<AsyntaiSettings>): Promise<AsyntaiSettings> {
    const pluginStore = strapi.store({
      type: 'plugin',
      name: 'asyntai-chatbot',
    });

    const currentSettings = await this.getSettings();

    const newSettings: AsyntaiSettings = {
      site_id: data.site_id?.trim() ?? currentSettings.site_id,
      script_url: data.script_url?.trim() || DEFAULT_SETTINGS.script_url,
      account_email: data.account_email?.trim() ?? currentSettings.account_email,
    };

    await pluginStore.set({
      key: 'settings',
      value: newSettings,
    });

    return newSettings;
  },

  async resetSettings(): Promise<AsyntaiSettings> {
    const pluginStore = strapi.store({
      type: 'plugin',
      name: 'asyntai-chatbot',
    });

    await pluginStore.set({
      key: 'settings',
      value: DEFAULT_SETTINGS,
    });

    return DEFAULT_SETTINGS;
  },
});

export default settingsService;
