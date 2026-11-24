import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Flex,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { PLUGIN_ID } from '../pluginId';

interface ContentType {
  uid: string;
  name: string;
  kind: string;
}

interface Settings {
  site_id: string;
  script_url: string;
  account_email: string;
  origin?: string;
  can_edit?: boolean;
  share?: {
    enabled: boolean;
    types: string[];
    all_types: ContentType[];
  };
}

const DEFAULT_SCRIPT = 'https://asyntai.com/static/js/chat-widget.js';

const HomePage = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [settings, setSettings] = useState<Settings>({
    site_id: '',
    script_url: DEFAULT_SCRIPT,
    account_email: '',
  });
  const [loading, setLoading] = useState(true);
  const [currentState, setCurrentState] = useState('');
  const [copied, setCopied] = useState(false);
  const [shareOnConnect, setShareOnConnect] = useState(true);
  const [syncText, setSyncText] = useState('');

  const origin = (settings.origin || 'https://asyntai.com').replace(/\/+$/, '');
  const connectBase = `${origin}/wp-auth?platform=strapi`;
  const shareEnabled = !!settings.share?.enabled;
  const sharedTypes = settings.share?.types || [];
  const allTypes = settings.share?.all_types || [];

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (!loading) {
      refreshStatus(0);
    }
  }, [loading, settings.site_id, shareEnabled]);

  const loadSettings = async () => {
    try {
      const { data } = await get(`/${PLUGIN_ID}/settings`);
      if (data) {
        setSettings(data);
      }
    } catch (error) {
      console.error('[Asyntai] Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateState = () => {
    return 'strapi_' + Math.random().toString(36).substr(2, 9);
  };

  const refreshStatus = async (tries: number) => {
    if (!settings.site_id || !shareEnabled) {
      setSyncText('');
      return;
    }
    try {
      const { data } = await get(`/${PLUGIN_ID}/sync-status`);
      const s = data?.sync;
      if (!s) {
        setSyncText('Asyntai has not read your content yet.');
        return;
      }
      if (s.status === 'syncing') {
        setSyncText('Reading your content…');
        if (tries < 20) {
          setTimeout(() => refreshStatus(tries + 1), 5000);
        }
        return;
      }
      if (s.status === 'failed') {
        setSyncText('The last read failed: ' + (s.error || 'unknown error'));
        return;
      }
      setSyncText(`Content shared: ${s.count || 0} items. Asyntai checks it again for changes.`);
    } catch {
      setSyncText('');
    }
  };

  // The sign-in window opens at once, inside the click, so a popup blocker
  // lets it through. It is pointed at the sign-in page as soon as the content
  // feed is parked. If parking fails, connecting works as before, only
  // without content sharing.
  const startConnect = async (share: boolean) => {
    const w = 800;
    const h = 720;
    const y = (window.top?.outerHeight || window.outerHeight) / 2 + (window.top?.screenY || window.screenY) - h / 2;
    const x = (window.top?.outerWidth || window.outerWidth) / 2 + (window.top?.screenX || window.screenX) - w / 2;
    const popup = window.open(
      '',
      'asyntai_connect',
      `toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${w},height=${h},top=${y},left=${x}`
    );

    if (!popup) {
      toggleNotification({
        type: 'danger',
        message: 'Popup blocked. Please allow popups and try again.',
      });
      return;
    }

    let state = '';
    try {
      const { data } = await post(`/${PLUGIN_ID}/prepare`, { share });
      if (data && data.success && data.state) {
        state = data.state;
      }
    } catch {
      // Connect without content sharing.
    }
    if (!state) {
      state = generateState();
    }
    setCurrentState(state);
    try {
      popup.location.href = `${connectBase}&state=${encodeURIComponent(state)}`;
    } catch {
      // The window was closed meanwhile.
    }
    pollForConnection(state);
  };

  const openPopup = () => {
    startConnect(shareOnConnect);
  };

  const pollForConnection = (state: string) => {
    // Signing up can take a few minutes, so keep waiting for 10 minutes.
    const until = Date.now() + 10 * 60 * 1000;
    let isConnected = false;

    const checkConnection = async () => {
      if (isConnected) {
        return;
      }

      if (Date.now() > until) {
        toggleNotification({
          type: 'danger',
          message: 'Connection timeout. Please try again or use the manual link below.',
        });
        return;
      }

      try {
        // Use server-side proxy to avoid CSP issues
        const { data } = await get(`/${PLUGIN_ID}/connect-status?state=${encodeURIComponent(state)}`);

        if (data && data.site_id) {
          toggleNotification({
            type: 'success',
            message: 'Asyntai connected. Saving…',
          });
          const success = await saveConnection(data);
          if (success) {
            isConnected = true;
          } else {
            setTimeout(checkConnection, 1000);
          }
        } else {
          setTimeout(checkConnection, 1000);
        }
      } catch (error) {
        setTimeout(checkConnection, 1000);
      }
    };

    checkConnection();
  };

  const saveConnection = async (data: any): Promise<boolean> => {
    try {
      const payload = {
        site_id: data.site_id,
        script_url: data.script_url || DEFAULT_SCRIPT,
        account_email: data.account_email || '',
      };

      const response = await post(`/${PLUGIN_ID}/settings`, payload);

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || 'Save failed');
      }

      toggleNotification({
        type: 'success',
        message: 'Asyntai connected successfully!',
      });
      await loadSettings();

      return true;
    } catch (error: any) {
      toggleNotification({
        type: 'danger',
        message: error?.message || String(error),
      });
      return false;
    }
  };

  const resetConnection = async () => {
    if (!confirm('Are you sure you want to disconnect Asyntai?')) {
      return;
    }

    try {
      const response = await post(`/${PLUGIN_ID}/settings/reset`, {});

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || 'Reset failed');
      }

      await loadSettings();
      setSyncText('');

      toggleNotification({
        type: 'success',
        message: 'Settings reset successfully',
      });
    } catch (error: any) {
      toggleNotification({
        type: 'danger',
        message: error?.message || String(error),
      });
    }
  };

  const saveShare = async (changes: { enabled?: boolean; types?: string[] }) => {
    try {
      const { data } = await post(`/${PLUGIN_ID}/share`, changes);
      if (!data || !data.success) {
        if (data && data.needs_connect) {
          toggleNotification({
            type: 'info',
            message: 'Sign in to Asyntai once more to share your content.',
          });
          startConnect(true);
          return;
        }
        throw new Error((data && data.error) || 'Could not save.');
      }
      setSettings((prev) => ({
        ...prev,
        share: { all_types: allTypes, enabled: !!data.enabled, types: data.types || [] },
      }));
      if (typeof changes.enabled === 'boolean') {
        toggleNotification({
          type: 'success',
          message: changes.enabled
            ? 'Content sharing is on.'
            : 'Content sharing is off. Asyntai can no longer read your content.',
        });
      }
    } catch (error: any) {
      toggleNotification({
        type: 'danger',
        message: error?.message || 'Could not save.',
      });
    }
  };

  const toggleType = (uid: string, on: boolean) => {
    const next = on ? [...sharedTypes, uid] : sharedTypes.filter((t) => t !== uid);
    saveShare({ types: Array.from(new Set(next)) });
  };

  const snippet = `<script>(function(){var l=function(){var s=document.createElement("script");s.src="${settings.script_url}";s.async=true;s.setAttribute("data-asyntai-id","${settings.site_id}");document.head.appendChild(s)};if(document.readyState==="complete"){l()}else{window.addEventListener("load",l)}})();</script>`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toggleNotification({
      type: 'success',
      message: 'Code copied to clipboard',
    });
  };

  const connected = settings.site_id?.trim() !== '';
  const canEdit = settings.can_edit !== false;

  if (loading) {
    return (
      <Box padding={8} background="neutral100">
        <Typography variant="alpha" as="h1">
          Asyntai AI Chatbot
        </Typography>
        <Box paddingTop={4}>
          <Typography>Loading...</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box padding={8} background="neutral100">
      <Typography variant="alpha" as="h1">
        Asyntai AI Chatbot
      </Typography>

      <Box paddingTop={4}>
        <Flex gap={2} alignItems="center">
          <Typography>
            Status:{' '}
            <span style={{ color: connected ? '#008a20' : '#a00', fontWeight: 'bold' }}>
              {connected ? 'Connected' : 'Not connected'}
            </span>
            {connected && settings.account_email && ` as ${settings.account_email}`}
          </Typography>
          {connected && canEdit && (
            <Button variant="secondary" size="S" onClick={resetConnection}>
              Reset
            </Button>
          )}
        </Flex>
      </Box>

      {!canEdit && (
        <Box paddingTop={4}>
          <Typography variant="pi" textColor="neutral600">
            Only a Super Admin can change these settings.
          </Typography>
        </Box>
      )}

      <Box paddingTop={6}>
        {connected ? (
          <Box
            padding={6}
            background="neutral0"
            shadow="filterShadow"
            borderColor="neutral150"
            hasRadius
          >
            <Box style={{ textAlign: 'center' }}>
              <Typography variant="beta" as="h3">
                Add this JavaScript snippet to all pages where you want to enable the chatbot
              </Typography>
            </Box>

            <Box paddingTop={4}>
              <Box
                padding={4}
                background="neutral100"
                borderColor="neutral200"
                hasRadius
                style={{ fontFamily: 'monospace', fontSize: '14px', overflowX: 'auto', textAlign: 'center' }}
              >
                <code>{snippet}</code>
              </Box>

              <Flex paddingTop={2} justifyContent="center">
                <Button variant="secondary" size="S" onClick={copyToClipboard}>
                  {copied ? 'Copied!' : 'Copy Code'}
                </Button>
              </Flex>
            </Box>

            <Box paddingTop={6} textAlign="center">
              <Typography>
                Set up your AI chatbot, review chat logs and more:
              </Typography>
              <Box paddingTop={2}>
                <Button
                  variant="default"
                  onClick={() => window.open('https://asyntai.com/dashboard', '_blank')}
                >
                  Open Asyntai Panel
                </Button>
              </Box>
              <Box paddingTop={4}>
                <Typography variant="pi" textColor="neutral600">
                  <strong>Tip:</strong> If you want to change how the AI answers, please{' '}
                  <a
                    href="https://asyntai.com/dashboard#setup"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#4945ff', textDecoration: 'underline' }}
                  >
                    go here
                  </a>
                  .
                </Typography>
              </Box>
            </Box>

            <Box paddingTop={6} style={{ borderTop: '1px solid #eaeaef', marginTop: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: canEdit ? 'pointer' : 'default' }}>
                <input
                  type="checkbox"
                  checked={shareEnabled}
                  disabled={!canEdit}
                  onChange={(e) => saveShare({ enabled: e.target.checked })}
                  style={{ marginTop: '4px' }}
                />
                <span>
                  <Typography><strong>Share my published content with the chatbot</strong></Typography>
                  <br />
                  <Typography variant="pi" textColor="neutral600">
                    Asyntai reads the published entries of the content types below, and checks them again for changes. Nothing in Strapi is changed.
                  </Typography>
                </span>
              </label>

              {shareEnabled && (
                <Box paddingTop={4} paddingLeft={6}>
                  <Typography variant="pi"><strong>Content types to share</strong></Typography>
                  {allTypes.length === 0 && (
                    <Box paddingTop={2}>
                      <Typography variant="pi" textColor="neutral600">
                        No content types yet. Create one in the Content-Type Builder.
                      </Typography>
                    </Box>
                  )}
                  {allTypes.map((t) => (
                    <Box key={t.uid} paddingTop={2}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: canEdit ? 'pointer' : 'default' }}>
                        <input
                          type="checkbox"
                          checked={sharedTypes.includes(t.uid)}
                          disabled={!canEdit}
                          onChange={(e) => toggleType(t.uid, e.target.checked)}
                        />
                        <Typography variant="omega">{t.name}</Typography>
                      </label>
                    </Box>
                  ))}
                </Box>
              )}

              {syncText && (
                <Box paddingTop={3}>
                  <Typography variant="pi" textColor="neutral700">{syncText}</Typography>
                </Box>
              )}
            </Box>
          </Box>
        ) : (
          <Box
            padding={6}
            background="neutral0"
            shadow="filterShadow"
            borderColor="neutral150"
            hasRadius
            textAlign="center"
          >
            <Typography>
              Create a free Asyntai account or sign in to enable the chatbot
            </Typography>
            <Box paddingTop={4}>
              <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '8px', textAlign: 'left', maxWidth: '560px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={shareOnConnect}
                  onChange={(e) => setShareOnConnect(e.target.checked)}
                  style={{ marginTop: '4px' }}
                />
                <span>
                  <Typography>Let the chatbot read my published content directly, so its answers stay up to date.</Typography>
                  <br />
                  <Typography variant="pi" textColor="neutral600">
                    Only published entries of the content types you choose. At first, the types the Public role can already read. Nothing in Strapi is changed.
                  </Typography>
                </span>
              </label>
            </Box>
            <Box paddingTop={4}>
              <Button variant="default" onClick={openPopup} disabled={!canEdit}>
                Get started
              </Button>
            </Box>
            <Box paddingTop={3}>
              <Typography variant="pi" textColor="neutral600">
                If it doesn't work,{' '}
                <a
                  href={`${connectBase}&state=${currentState || generateState()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#4945ff', textDecoration: 'underline' }}
                  onClick={(e) => {
                    const state = generateState();
                    setCurrentState(state);
                    (e.target as HTMLAnchorElement).href = `${connectBase}&state=${state}`;
                    setTimeout(() => pollForConnection(state), 1000);
                  }}
                >
                  open the connect window
                </a>
                .
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default HomePage;
