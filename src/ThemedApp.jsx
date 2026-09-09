import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import App from './App';
import {
  THEME_MODES, THEME_SETTING_KEY, DEFAULT_THEME_MODE,
  resolveThemeMode, systemPrefersDark, applyThemeToDocument
} from './theme';

// =====================================================================
// v2.2 R9 — theme host.
//
// Owns the persisted mode preference ('system' | 'light' | 'dark') and
// resolves it against prefers-color-scheme. Any change is applied live:
//   1. antd ConfigProvider algorithm  -> themes antd components;
//   2. <html data-theme>               -> themes CSS design tokens.
// Mode selection lives in the native View > 主题 menu (main process owns
// settings.json); the renderer only listens for theme:set menu events and
// follows the OS scheme while in 'system' mode.
// =====================================================================

function resolveFromMedia(mode) {
  return resolveThemeMode(mode, systemPrefersDark());
}

function ThemedApp() {
  const modeRef = useRef(DEFAULT_THEME_MODE);
  const [resolved, setResolved] = useState(() => resolveFromMedia(DEFAULT_THEME_MODE));

  const applyResolved = useCallback((mode) => {
    modeRef.current = mode;
    const r = resolveFromMedia(mode);
    setResolved(r);
    applyThemeToDocument(r);
  }, []);

  // Initial sync: apply the OS-derived default immediately (so CSS tokens are
  // correct from the first paint), then re-apply from persisted settings.
  useEffect(() => {
    applyResolved(DEFAULT_THEME_MODE);
    let cancelled = false;
    const gs = window.electronAPI?.getSettings;
    if (typeof gs === 'function') {
      gs()
        .then(s => {
          if (cancelled) return;
          const stored = s && THEME_MODES.includes(s[THEME_SETTING_KEY])
            ? s[THEME_SETTING_KEY]
            : DEFAULT_THEME_MODE;
          applyResolved(stored);
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [applyResolved]);

  // View > 主题 menu clicks (persistence happens in the main process).
  useEffect(() => {
    const on = window.electronAPI?.onMenuEvent;
    if (typeof on !== 'function') return undefined;
    return on(({ action, payload }) => {
      if (action === 'theme:set' && THEME_MODES.includes(payload && payload.theme)) {
        applyResolved(payload.theme);
      }
    });
  }, [applyResolved]);

  // Follow OS scheme changes while in 'system' mode (Electron maps
  // prefers-color-scheme to nativeTheme, so this follows the OS theme).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (modeRef.current === 'system') applyResolved('system');
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
    return undefined;
  }, [applyResolved]);

  const { defaultAlgorithm, darkAlgorithm } = antdTheme;
  return (
    <ConfigProvider theme={{ algorithm: resolved === 'dark' ? darkAlgorithm : defaultAlgorithm }}>
      <App />
    </ConfigProvider>
  );
}

export default ThemedApp;
