import type { Core } from '@strapi/strapi';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  // Initialize plugin store with default settings if not exists
  const pluginStore = strapi.store({
    type: 'plugin',
    name: 'asyntai-chatbot',
  });

  const existingSettings = await pluginStore.get({ key: 'settings' });

  if (!existingSettings) {
    await pluginStore.set({
      key: 'settings',
      value: {
        site_id: '',
        script_url: 'https://asyntai.com/static/js/chat-widget.js',
        account_email: '',
      },
    });
  }
};

export default bootstrap;
