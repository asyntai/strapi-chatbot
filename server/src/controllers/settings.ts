import type { Core } from '@strapi/strapi';

const SITE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const DEFAULT_SCRIPT = 'https://asyntai.com/static/js/chat-widget.js';

/** Only the Asyntai widget script may be put on the site. */
function cleanScriptUrl(url: unknown): string {
  const value = typeof url === 'string' ? url.trim() : '';
  return /^https:\/\/asyntai\.com\/[A-Za-z0-9/._-]+\.js$/.test(value) ? value : DEFAULT_SCRIPT;
}

/** Settings changes need a Super Admin. */
function isSuperAdmin(ctx: any): boolean {
  const roles = ctx?.state?.user?.roles;
  return Array.isArray(roles) && roles.some((role: any) => role?.code === 'strapi-super-admin');
}

const settingsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const settings = () => strapi.plugin('asyntai-chatbot').service('settings');
  const feed = () => strapi.plugin('asyntai-chatbot').service('feed');

  const refuse = (ctx: any) => {
    ctx.status = 403;
    ctx.body = { success: false, error: 'Only a Super Admin can change the Asyntai settings.' };
  };

  return {
    // GET /asyntai-chatbot/settings - Get current settings
    async getSettings(ctx: any) {
      try {
        const current = await settings().getSettings();
        const shared = await feed().get();
        const sharedTypes = await feed().sharedTypes();
        ctx.body = {
          ...current,
          origin: feed().origin(),
          can_edit: isSuperAdmin(ctx),
          share: {
            enabled: !!(shared.feed_enabled && shared.feed_token),
            types: sharedTypes,
            all_types: feed().contentTypes(),
          },
        };
      } catch (error: any) {
        strapi.log.error('[Asyntai] Error retrieving settings: ' + (error?.message || error));
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: 'Failed to retrieve settings',
        };
      }
    },

    // POST /asyntai-chatbot/settings - Save the sign-in result
    async setSettings(ctx: any) {
      if (!isSuperAdmin(ctx)) return refuse(ctx);
      try {
        const { site_id, script_url, account_email } = ctx.request.body || {};

        if (typeof site_id !== 'string' || !SITE_ID_RE.test(site_id.trim())) {
          ctx.status = 400;
          ctx.body = {
            success: false,
            error: 'missing site_id',
          };
          return;
        }

        const saved = await settings().setSettings({
          site_id: site_id.trim(),
          script_url: cleanScriptUrl(script_url),
          account_email: typeof account_email === 'string' ? account_email.trim().slice(0, 255) : '',
        });

        // The feed token parked by the last "prepare" becomes live now that
        // the sign-in it belongs to has finished.
        const current = await feed().get();
        if (current.handshake_token) {
          await feed().update({
            feed_token: current.handshake_token,
            feed_enabled: !!current.handshake_share,
            handshake_token: '',
            handshake_share: false,
          });
        }
        const after = await feed().get();

        ctx.body = {
          success: true,
          saved,
          share_enabled: !!(after.feed_enabled && after.feed_token),
        };
      } catch (error: any) {
        strapi.log.error('[Asyntai] Error saving settings: ' + (error?.message || error));
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: 'Failed to save settings',
        };
      }
    },

    // POST /asyntai-chatbot/settings/reset - Disconnect. The feed token goes
    // too: a token kept after a reset could only sign a call nobody should make.
    async resetSettings(ctx: any) {
      if (!isSuperAdmin(ctx)) return refuse(ctx);
      try {
        await settings().resetSettings();
        await feed().clear();
        ctx.body = {
          success: true,
        };
      } catch (error: any) {
        strapi.log.error('[Asyntai] Error resetting settings: ' + (error?.message || error));
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: 'Reset failed',
        };
      }
    },

    // POST /asyntai-chatbot/prepare - Park a fresh feed token at Asyntai under
    // a one-time handshake id. Without "share" nothing is parked, so
    // connecting works exactly as before content sharing existed.
    async prepare(ctx: any) {
      if (!isSuperAdmin(ctx)) return refuse(ctx);
      const share = !!(ctx.request.body || {}).share;
      const state = feed().newState();

      if (!share) {
        await feed().update({ handshake_token: '', handshake_share: false });
        ctx.body = { success: true, state, staged: false };
        return;
      }

      const token = feed().newToken();
      const root = feed().root(ctx.request.origin);
      const answer = await feed().postJson(`${feed().origin()}/api/v1/wp-search/stage/`, {
        state,
        platform: 'strapi',
        feed_protocol: 'store_feed_v1',
        // A chatbot install must never unlock the paid AI Search bar.
        product: 'chat',
        site_url: root,
        feed_url: feed().feedUrl(root, 'products'),
        feed_token: token,
      });

      if (answer === null) {
        ctx.body = { success: false, error: 'Could not reach Asyntai. Please try again later.' };
        return;
      }

      // Kept aside until the sign-in finishes, so a handshake that is never
      // completed leaves no live token behind.
      await feed().update({ handshake_token: token, handshake_share: true });
      ctx.body = { success: true, state, staged: true };
    },

    // POST /asyntai-chatbot/share - Switch content sharing on or off, and
    // choose the content types.
    async share(ctx: any) {
      if (!isSuperAdmin(ctx)) return refuse(ctx);
      const body = ctx.request.body || {};
      const changes: any = {};

      if (Array.isArray(body.types)) {
        const known = new Set(feed().contentTypes().map((t: any) => t.uid));
        changes.types = body.types.filter((uid: unknown) => typeof uid === 'string' && known.has(uid));
      }
      if (typeof body.enabled === 'boolean') {
        const current = await feed().get();
        if (body.enabled && !current.feed_token) {
          // Connected before content sharing existed, or after a reset:
          // Asyntai has no token for this site yet, so the owner signs in
          // once more.
          ctx.body = { success: false, needs_connect: true };
          return;
        }
        changes.feed_enabled = body.enabled;
      }

      const after = await feed().update(changes);
      ctx.body = {
        success: true,
        enabled: !!(after.feed_enabled && after.feed_token),
        types: await feed().sharedTypes(),
      };
    },

    // GET /asyntai-chatbot/sync-status - What Asyntai says about the last read.
    async syncStatus(ctx: any) {
      const current = await settings().getSettings();
      if (!current.site_id) {
        ctx.body = { success: true, sync: null };
        return;
      }
      const data = await feed().getJson(
        `${feed().origin()}/api/v1/search-widget/status/?widget_id=${encodeURIComponent(current.site_id)}`
      );
      const sync = data && typeof data.sync === 'object' && data.sync ? data.sync : null;
      ctx.body = {
        success: true,
        sync: sync && {
          status: String(sync.status || ''),
          count: Number(sync.count || 0),
          error: String(sync.error || ''),
        },
      };
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
        const url = `${feed().origin()}/connect-status.js?state=${encodeURIComponent(state)}&cb=${callbackName}`;

        const response = await fetch(url, {
          method: 'GET',
        });

        if (!response.ok) {
          ctx.body = { site_id: null };
          return;
        }

        const text = await response.text();

        // Parse JSONP response: "cb({...})" or "cb(null)"
        const match = text.match(new RegExp(`^${callbackName}\\((.*)\\)$`));

        if (!match) {
          ctx.body = { site_id: null };
          return;
        }

        const jsonStr = match[1];

        if (jsonStr === 'null' || jsonStr === '') {
          ctx.body = { site_id: null };
          return;
        }

        try {
          ctx.body = JSON.parse(jsonStr);
        } catch {
          ctx.body = { site_id: null };
        }
      } catch (error: any) {
        strapi.log.error('[Asyntai] Error checking connect status: ' + (error?.message || error));
        // Return empty response on error - don't break the polling
        ctx.body = { site_id: null };
      }
    },
  };
};

export default settingsController;
