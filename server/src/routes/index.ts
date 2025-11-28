export default {
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
    ],
  },
};
