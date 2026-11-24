import type { Core } from '@strapi/strapi';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Content sharing in the Asyntai store feed format (store_feed_v1).
 *
 * The plugin serves a signed, read-only feed of the published entries of the
 * content types the admin chose. Asyntai reads it so the chatbot answers from
 * the current content. Nothing in Strapi is created or changed.
 */

const STORE = { type: 'plugin', name: 'asyntai-chatbot' } as const;
const FEED_KEY = 'feed';

// How far a signed feed call may be from this server's clock.
const FEED_CLOCK_SKEW = 300;
// Entries per feed page, and the most a caller may ask for.
const FEED_PAGE_SIZE = 50;
const FEED_MAX_PAGE_SIZE = 100;
// How deep components inside components are read.
const MAX_DEPTH = 4;

export interface FeedSettings {
  feed_token: string;
  feed_enabled: boolean;
  handshake_token: string;
  handshake_share: boolean;
  // null: the content types the Public role can already read.
  types: string[] | null;
}

const DEFAULT_FEED: FeedSettings = {
  feed_token: '',
  feed_enabled: false,
  handshake_token: '',
  handshake_share: false,
  types: null,
};

const TITLE_FIELDS = ['title', 'name', 'heading', 'headline', 'question', 'label', 'subject'];
// Contact details and secrets are never page text, whatever their field type.
const SKIP_FIELD = /(e-?mail|phone|password|passwd|token|secret|api[-_]?key)/i;

function plainMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '');
}

function cleanText(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Text of a Strapi 5 "blocks" rich text value. */
function blocksText(nodes: any): string {
  if (!Array.isArray(nodes)) return '';
  const out: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (typeof node.text === 'string') {
      out.push(node.text);
      continue;
    }
    if (node.type === 'image') continue;
    const inner = blocksText(node.children);
    const block = ['paragraph', 'heading', 'list-item', 'quote', 'code', 'list'].includes(node.type);
    out.push(block ? inner + '\n' : inner);
  }
  return out.join('');
}

const feedService = ({ strapi }: { strapi: Core.Strapi }) => ({
  // ------------------------------------------------------------------
  // Storage. The tokens never leave the server.
  // ------------------------------------------------------------------

  async get(): Promise<FeedSettings> {
    const stored = (await strapi.store(STORE).get({ key: FEED_KEY })) as Partial<FeedSettings> | null;
    return { ...DEFAULT_FEED, ...(stored || {}) };
  },

  async update(changes: Partial<FeedSettings>): Promise<FeedSettings> {
    const next = { ...(await this.get()), ...changes };
    await strapi.store(STORE).set({ key: FEED_KEY, value: next });
    return next;
  },

  async clear(): Promise<void> {
    await strapi.store(STORE).set({ key: FEED_KEY, value: DEFAULT_FEED });
  },

  newToken(): string {
    return randomBytes(24).toString('hex');
  },

  newState(): string {
    return 'strapi_' + randomBytes(12).toString('hex');
  },

  origin(): string {
    const custom = String(strapi.config.get('plugin::asyntai-chatbot.origin') || '');
    return (custom || 'https://asyntai.com').replace(/\/+$/, '');
  },

  /** The public address of this Strapi server, without a trailing slash. */
  root(fallback: string): string {
    const configured = String(strapi.config.get('server.url') || '');
    const base = /^https?:\/\//i.test(configured) ? configured : fallback;
    return base.replace(/\/+$/, '');
  },

  apiPrefix(): string {
    const prefix = String(strapi.config.get('api.rest.prefix') || '/api');
    return '/' + prefix.replace(/^\/+|\/+$/g, '');
  },

  feedUrl(root: string, which: 'products' | 'pages'): string {
    return `${root}${this.apiPrefix()}/asyntai-chatbot/feed/${which}`;
  },

  // ------------------------------------------------------------------
  // Content types
  // ------------------------------------------------------------------

  /** Every content type made in the Content-Type Builder. */
  contentTypes(): { uid: string; name: string; kind: string }[] {
    return Object.entries(strapi.contentTypes as Record<string, any>)
      .filter(([uid]) => uid.startsWith('api::'))
      .map(([uid, ct]) => ({
        uid,
        name: String(ct?.info?.displayName || ct?.info?.singularName || uid),
        kind: String(ct?.kind || 'collectionType'),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** The content types the Public role can already read through the API. */
  async publicTypes(): Promise<string[]> {
    const known = new Set(this.contentTypes().map((t) => t.uid));
    try {
      const rows = await strapi.db.query('plugin::users-permissions.permission').findMany({
        where: { role: { type: 'public' } },
        select: ['action'],
      });
      const uids = new Set<string>();
      for (const row of rows as any[]) {
        const m = /^(api::[^.]+\.[^.]+)\.(find|findOne)$/.exec(String(row.action || ''));
        if (m && known.has(m[1])) uids.add(m[1]);
      }
      return [...uids].sort();
    } catch {
      return [];
    }
  },

  async sharedTypes(): Promise<string[]> {
    const feed = await this.get();
    const known = new Set(this.contentTypes().map((t) => t.uid));
    const chosen = Array.isArray(feed.types) ? feed.types : await this.publicTypes();
    return chosen.filter((uid) => known.has(uid)).sort();
  },

  // ------------------------------------------------------------------
  // The signed feed
  // ------------------------------------------------------------------

  /** null when the call is valid, else the reason to refuse it. */
  async checkSignature(query: Record<string, any>): Promise<string | null> {
    const feed = await this.get();
    // The live token, and the one parked by the last "prepare". Asyntai
    // starts its first read the moment the owner signs in, a moment BEFORE
    // this server saves the sign-in result, so the parked token is accepted
    // too. It was only ever sent to Asyntai.
    const tokens: string[] = [];
    if (feed.feed_enabled && feed.feed_token) tokens.push(feed.feed_token);
    if (feed.handshake_share && feed.handshake_token) tokens.push(feed.handshake_token);
    if (!tokens.length) return 'Content sharing is switched off on this site.';

    const raw = (key: string) => (typeof query[key] === 'string' ? query[key] : '');
    const ts = raw('ts');
    if (!/^\d+$/.test(ts)) return 'Missing timestamp.';
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > FEED_CLOCK_SKEW) {
      return 'The request has expired.';
    }
    // Signed over the raw values, in a fixed order, before any clamping.
    const signed = `page=${raw('page')}&limit=${raw('limit')}&ids=${raw('ids')}&ts=${ts}`;
    const sig = Buffer.from(raw('sig').toLowerCase());
    for (const token of tokens) {
      const want = Buffer.from(createHmac('sha256', token).update(signed).digest('hex'));
      if (sig.length === want.length && timingSafeEqual(sig, want)) return null;
    }
    return 'Bad signature.';
  },

  pageArgs(query: Record<string, any>): { page: number; size: number } {
    const page = Math.max(1, parseInt(String(query.page || ''), 10) || 1);
    let size = parseInt(String(query.limit || ''), 10) || 0;
    if (size < 1 || size > FEED_MAX_PAGE_SIZE) size = FEED_PAGE_SIZE;
    return { page, size };
  },

  storeInfo(root: string) {
    return {
      name: root.replace(/^https?:\/\//i, ''),
      url: root,
      currency: '',
      version: String(strapi.config.get('info.strapi') || ''),
      pages_url: this.feedUrl(root, 'pages'),
    };
  },

  /** populate object that reads every component and dynamic zone. */
  populateFor(attributes: Record<string, any>, depth: number): Record<string, any> | undefined {
    const populate: Record<string, any> = {};
    for (const [name, attr] of Object.entries(attributes || {})) {
      if (!attr || attr.private) continue;
      if (attr.type === 'component') {
        const model = strapi.components[attr.component as keyof typeof strapi.components] as any;
        const nested = depth > 0 && model ? this.populateFor(model.attributes, depth - 1) : undefined;
        populate[name] = nested ? { populate: nested } : true;
      } else if (attr.type === 'dynamiczone') {
        const on: Record<string, any> = {};
        for (const uid of attr.components || []) {
          const model = strapi.components[uid as keyof typeof strapi.components] as any;
          const nested = depth > 0 && model ? this.populateFor(model.attributes, depth - 1) : undefined;
          on[uid] = nested ? { populate: nested } : true;
        }
        populate[name] = { on };
      }
    }
    return Object.keys(populate).length ? populate : undefined;
  },

  /** Plain text of one entry or component, in field order. */
  entryText(attributes: Record<string, any>, data: any, depth: number, skip?: string): string {
    if (!data || typeof data !== 'object') return '';
    const parts: string[] = [];
    for (const [name, attr] of Object.entries(attributes || {})) {
      if (!attr || attr.private || name === skip || SKIP_FIELD.test(name)) continue;
      const value = data[name];
      if (value === null || value === undefined || value === '') continue;
      let text = '';
      switch (attr.type) {
        case 'string':
        case 'text':
          text = typeof value === 'string' ? value : '';
          break;
        case 'richtext':
          text = typeof value === 'string' ? plainMarkdown(value) : '';
          break;
        case 'blocks':
          text = blocksText(value);
          break;
        case 'component': {
          const model = strapi.components[attr.component as keyof typeof strapi.components] as any;
          if (model && depth > 0) {
            const items = Array.isArray(value) ? value : [value];
            text = items.map((item: any) => this.entryText(model.attributes, item, depth - 1)).join('\n');
          }
          break;
        }
        case 'dynamiczone':
          if (Array.isArray(value) && depth > 0) {
            text = value
              .map((item: any) => {
                const model = strapi.components[item?.__component as keyof typeof strapi.components] as any;
                return model ? this.entryText(model.attributes, item, depth - 1) : '';
              })
              .join('\n');
          }
          break;
        default:
          // Numbers, dates, emails, passwords, media, relations, JSON and
          // other values are not page text.
          text = '';
      }
      text = cleanText(text);
      if (text) parts.push(text);
    }
    return parts.join('\n\n');
  },

  titleField(attributes: Record<string, any>): string {
    for (const name of TITLE_FIELDS) {
      const attr = attributes?.[name];
      if (attr && !attr.private && (attr.type === 'string' || attr.type === 'text')) return name;
    }
    for (const [name, attr] of Object.entries(attributes || {})) {
      if (attr && !(attr as any).private && (attr as any).type === 'string') return name;
    }
    return '';
  },

  hasDraftAndPublish(ct: any): boolean {
    return ct?.options?.draftAndPublish === true;
  },

  async countEntries(uid: string): Promise<number> {
    const ct = strapi.contentTypes[uid as keyof typeof strapi.contentTypes] as any;
    const params: any = {};
    if (this.hasDraftAndPublish(ct)) params.status = 'published';
    return (strapi.documents(uid as any) as any).count(params);
  },

  /** One page of the shared entries, across all shared content types. */
  async pages(pageNo: number, size: number) {
    const types = await this.sharedTypes();
    const counts: number[] = [];
    for (const uid of types) counts.push(await this.countEntries(uid));
    const total = counts.reduce((a, b) => a + b, 0);

    let skip = (pageNo - 1) * size;
    let want = size;
    const items: any[] = [];
    for (let i = 0; i < types.length && want > 0; i++) {
      if (skip >= counts[i]) {
        skip -= counts[i];
        continue;
      }
      const uid = types[i];
      const ct = strapi.contentTypes[uid as keyof typeof strapi.contentTypes] as any;
      const attributes = ct?.attributes || {};
      const params: any = {
        start: skip,
        limit: Math.min(want, counts[i] - skip),
        sort: { id: 'asc' },
      };
      if (this.hasDraftAndPublish(ct)) params.status = 'published';
      const populate = this.populateFor(attributes, MAX_DEPTH);
      if (populate) params.populate = populate;

      const rows = await (strapi.documents(uid as any) as any).findMany(params);
      const titleKey = this.titleField(attributes);
      const typeName = String(ct?.info?.displayName || uid);
      for (const row of rows || []) {
        const rawTitle = titleKey && typeof row[titleKey] === 'string' ? row[titleKey].trim() : '';
        const title = rawTitle || (ct?.kind === 'singleType' ? typeName : `${typeName} ${row.id}`);
        const content = this.entryText(attributes, row, MAX_DEPTH, rawTitle ? titleKey : undefined);
        if (!content) continue;
        items.push({ type: 'page', title, content });
      }
      want -= Math.min(want, counts[i] - skip);
      skip = 0;
    }

    return {
      ok: true,
      page: pageNo,
      pages: Math.ceil(total / Math.max(1, size)),
      total,
      items,
    };
  },

  // ------------------------------------------------------------------
  // Talking to Asyntai
  // ------------------------------------------------------------------

  async postJson(url: string, payload: unknown): Promise<any | null> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      return await res.json().catch(() => ({}));
    } catch {
      return null;
    }
  },

  async getJson(url: string): Promise<any | null> {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
});

export default feedService;
