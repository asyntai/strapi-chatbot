import type { Core } from '@strapi/strapi';

/**
 * The signed feed: GET /api/asyntai-chatbot/feed/products and /feed/pages.
 * It is the only public address of the plugin, and it answers only calls
 * signed with the token Asyntai holds.
 */
const feedController = ({ strapi }: { strapi: Core.Strapi }) => {
  const feed = () => strapi.plugin('asyntai-chatbot').service('feed');

  const send = (ctx: any, status: number, body: unknown) => {
    ctx.status = status;
    ctx.set('Cache-Control', 'no-store');
    ctx.set('X-Robots-Tag', 'noindex');
    ctx.body = body;
  };

  return {
    async products(ctx: any) {
      const refused = await feed().checkSignature(ctx.query || {});
      if (refused) return send(ctx, 403, { ok: false, error: refused });
      const { page } = feed().pageArgs(ctx.query || {});
      // A Strapi site sells nothing through this plugin, so the catalogue is
      // always empty. It still answers, because Asyntai reads the pages
      // address from it.
      return send(ctx, 200, {
        ok: true,
        store: feed().storeInfo(feed().root(ctx.request.origin)),
        page,
        pages: 0,
        total: 0,
        categories: [],
        products: [],
      });
    },

    async pages(ctx: any) {
      const refused = await feed().checkSignature(ctx.query || {});
      if (refused) return send(ctx, 403, { ok: false, error: refused });
      const { page, size } = feed().pageArgs(ctx.query || {});
      try {
        return send(ctx, 200, await feed().pages(page, size));
      } catch (error: any) {
        strapi.log.error('[Asyntai] Could not read the shared content: ' + (error?.message || error));
        return send(ctx, 500, { ok: false, error: 'Could not read the content.' });
      }
    },
  };
};

export default feedController;
