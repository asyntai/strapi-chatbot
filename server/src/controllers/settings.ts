import type { Core } from '@strapi/strapi';

interface AsyntaiSettings {
  site_id: string;
  script_url: string;
  account_email: string;
}

const settingsController = ({ strapi }: { strapi: Core.Strapi }) => ({
  // GET /asyntai-chatbot/settings - Get current settings
  async getSettings(ctx: any) {
    try {
      const settings = await strapi.plugin('asyntai-chatbot').service('settings').getSettings();
      ctx.body = settings;
    } catch (error: any) {
      strapi.log.error('[Asyntai] Error retrieving settings:', error);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error?.message || 'Failed to retrieve settings',
      };
    }
  },

  // POST /asyntai-chatbot/settings - Save settings
  async setSettings(ctx: any) {
    try {
      const { site_id, script_url, account_email } = ctx.request.body || {};

      if (!site_id || typeof site_id !== 'string' || site_id.trim() === '') {
        ctx.status = 400;
        ctx.body = {
          success: false,
          error: 'missing site_id',
        };
        return;
      }

      const settings = await strapi.plugin('asyntai-chatbot').service('settings').setSettings({
        site_id,
        script_url,
        account_email,
      });

      ctx.body = {
        success: true,
        saved: settings,
      };
    } catch (error: any) {
      strapi.log.error('[Asyntai] Error saving settings:', error);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error?.message || 'Failed to save settings',
      };
    }
  },

  // POST /asyntai-chatbot/settings/reset - Reset settings
  async resetSettings(ctx: any) {
    try {
      await strapi.plugin('asyntai-chatbot').service('settings').resetSettings();
      ctx.body = {
        success: true,
      };
    } catch (error: any) {
      strapi.log.error('[Asyntai] Error resetting settings:', error);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error?.message || 'Reset failed',
      };
    }
  },

  // GET /asyntai-chatbot/connect-status - Proxy to check connection status from asyntai.com
  async getConnectStatus(ctx: any) {
    try {
      const { state } = ctx.query;

      if (!state) {
        ctx.status = 400;
        ctx.body = { error: 'missing state parameter' };
        return;
      }

      // Use JSONP endpoint with a dummy callback name
      const callbackName = 'cb';
      const url = `https://asyntai.com/connect-status.js?state=${encodeURIComponent(state)}&cb=${callbackName}`;

      const response = await fetch(url, {
        method: 'GET',
      });

      if (!response.ok) {
        ctx.body = { site_id: null };
        return;
      }

      const text = await response.text();

      // Parse JSONP response: "cb({...})" or "cb(null)"
      // Extract the JSON part from callback(DATA)
      const match = text.match(new RegExp(`^${callbackName}\\((.*)\\)$`));

      if (!match) {
        ctx.body = { site_id: null };
        return;
      }

      const jsonStr = match[1];

      // Handle null response
      if (jsonStr === 'null' || jsonStr === '') {
        ctx.body = { site_id: null };
        return;
      }

      try {
        const data = JSON.parse(jsonStr);
        ctx.body = data;
      } catch {
        ctx.body = { site_id: null };
      }
    } catch (error: any) {
      strapi.log.error('[Asyntai] Error checking connect status:', error);
      // Return empty response on error - don't break the polling
      ctx.body = { site_id: null };
    }
  },
});

export default settingsController;
