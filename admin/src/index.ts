import { Message } from '@strapi/icons';
import { PLUGIN_ID } from './pluginId';

export default {
  register(app: any) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: Message,
      intlLabel: {
        id: `${PLUGIN_ID}.plugin.name`,
        defaultMessage: 'Asyntai AI Chatbot',
      },
      Component: async () => {
        const component = await import('./pages/HomePage');
        return component;
      },
    });

    app.registerPlugin({
      id: PLUGIN_ID,
      name: 'Asyntai AI Chatbot',
    });
  },

  bootstrap(app: any) {
    // Bootstrap lifecycle
  },

  async registerTrads({ locales }: { locales: string[] }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./translations/${locale}.json`);
          return { data, locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
  },
};
