import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Flex,
  Alert,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { PLUGIN_ID } from '../pluginId';

interface Settings {
  site_id: string;
  script_url: string;
  account_email: string;
}

const HomePage = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [settings, setSettings] = useState<Settings>({
    site_id: '',
    script_url: 'https://asyntai.com/static/js/chat-widget.js',
    account_email: '',
  });
  const [loading, setLoading] = useState(true);
  const [currentState, setCurrentState] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

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

  const openPopup = () => {
    const state = generateState();
    setCurrentState(state);

    const url = `https://asyntai.com/wp-auth?platform=strapi&state=${encodeURIComponent(state)}`;

    const w = 800;
    const h = 720;
    const y = (window.top?.outerHeight || window.outerHeight) / 2 + (window.top?.screenY || window.screenY) - h / 2;
    const x = (window.top?.outerWidth || window.outerWidth) / 2 + (window.top?.screenX || window.screenX) - w / 2;
    const popup = window.open(
      url,
      'asyntai_connect',
      `toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${w},height=${h},top=${y},left=${x}`
    );

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      console.error('[Asyntai] Popup blocked');
      toggleNotification({
        type: 'danger',
        message: 'Popup blocked. Please allow popups and try again.',
      });
    } else {
      pollForConnection(state);
    }
  };

  const pollForConnection = (state: string) => {
    let attempts = 0;
    const maxAttempts = 60;
    let isConnected = false;

    const checkConnection = async () => {
      if (isConnected) {
        return;
      }

      attempts++;

      if (attempts > maxAttempts) {
        console.error('[Asyntai] Connection timeout after', maxAttempts, 'attempts');
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
            console.warn('[Asyntai] Save failed, will retry');
            setTimeout(checkConnection, 1000);
          }
        } else {
          setTimeout(checkConnection, 1000);
        }
      } catch (error) {
        console.warn('[Asyntai] Connection check error:', error);
        setTimeout(checkConnection, 1000);
      }
    };

    checkConnection();
  };

  const saveConnection = async (data: any): Promise<boolean> => {
    try {
      const payload = {
        site_id: data.site_id,
        script_url: data.script_url || 'https://asyntai.com/static/js/chat-widget.js',
        account_email: data.account_email || '',
      };

      const response = await post(`/${PLUGIN_ID}/settings`, payload);

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || 'Save failed');
      }

      setSettings(response.data.saved);
      toggleNotification({
        type: 'success',
        message: 'Asyntai connected successfully!',
      });

      return true;
    } catch (error: any) {
      console.error('[Asyntai] Save error:', error);
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

      setSettings({
        site_id: '',
        script_url: 'https://asyntai.com/static/js/chat-widget.js',
        account_email: '',
      });

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

  const copyToClipboard = () => {
    const snippet = `<script src="${settings.script_url}" data-asyntai-id="${settings.site_id}" async></script>`;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toggleNotification({
      type: 'success',
      message: 'Code copied to clipboard',
    });
  };

  const connected = settings.site_id?.trim() !== '';

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
          {connected && (
            <Button variant="secondary" size="S" onClick={resetConnection}>
              Reset
            </Button>
          )}
        </Flex>
      </Box>

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
                <code>{`<script src="${settings.script_url}" data-asyntai-id="${settings.site_id}" async></script>`}</code>
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
              <Button variant="default" onClick={openPopup}>
                Get started
              </Button>
            </Box>
            <Box paddingTop={3}>
              <Typography variant="pi" textColor="neutral600">
                If it doesn't work,{' '}
                <a
                  href={`https://asyntai.com/wp-auth?platform=strapi&state=${currentState || generateState()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#4945ff', textDecoration: 'underline' }}
                  onClick={(e) => {
                    const state = generateState();
                    setCurrentState(state);
                    (e.target as HTMLAnchorElement).href = `https://asyntai.com/wp-auth?platform=strapi&state=${state}`;
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
