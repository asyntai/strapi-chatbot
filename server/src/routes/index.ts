export default {
  // Admin panel only: needs a signed-in Strapi admin.
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/settings',
        handler: 'settings.getSettings',
        config: {
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/settings',
        handler: 'settings.setSettings',
        config: {
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/settings/reset',
        handler: 'settings.resetSettings',
        config: {
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/connect-status',
        handler: 'settings.getConnectStatus',
        config: {
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/prepare',
        handler: 'settings.prepare',
        config: {
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/share',
        handler: 'settings.share',
        config: {
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/sync-status',
        handler: 'settings.syncStatus',
        config: {
          policies: [],
        },
      },
    ],
  },
  // The signed feed Asyntai reads. Public, but it answers only signed calls.
  'content-api': {
    type: 'content-api',
    routes: [
      {
        method: 'GET',
        path: '/feed/products',
        handler: 'feed.products',
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/feed/pages',
        handler: 'feed.pages',
        config: {
          auth: false,
          policies: [],
        },
      },
    ],
  },
};
