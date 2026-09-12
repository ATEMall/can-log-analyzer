import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { message, theme as antdTheme } from 'antd';
import ThemedApp from '../ThemedApp';
import {
  THEME_MODES, DEFAULT_THEME_MODE, BRAND_PRIMARY,
  resolveThemeMode, systemPrefersDark, applyThemeToDocument, cssVar, antdThemeConfig
} from '../theme';

// =====================================================================
// v2.2 R9 — theme core + theme host tests.
//
// Core unit tests (resolveThemeMode / applyThemeToDocument) need no DOM
// app. The host tests render <ThemedApp/> with a mocked electronAPI and
// assert the persisted mode preference drives <html data-theme>, and that
// a View > 主题 menu event flips the live theme without a reload.
// =====================================================================

const html = () => document.documentElement;

let menuHandlers = [];
const makeElectronAPI = (settings = {}) => ({
  getCRCAlgorithms: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue(settings),
  setSettings: vi.fn().mockResolvedValue({ success: true }),
  onMenuEvent: vi.fn((cb) => {
    menuHandlers.push(cb);
    return () => { menuHandlers = menuHandlers.filter(h => h !== cb); };
  }),
  onCacheCompressProgress: vi.fn(() => () => {}),
  onExportProgress: vi.fn(() => () => {}),
  onProjectOpenRequest: vi.fn(() => () => {})
});

beforeEach(() => {
  menuHandlers = [];
  vi.spyOn(message, 'success').mockImplementation(() => {});
  vi.spyOn(message, 'error').mockImplementation(() => {});
  vi.spyOn(message, 'warning').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  html().removeAttribute('data-theme');
  html().style.colorScheme = '';
  html().style.removeProperty('--r9-test-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  html().removeAttribute('data-theme');
  html().style.colorScheme = '';
});

describe('theme core (theme.js)', () => {
  it('exposes a fixed mode list defaulting to system', () => {
    expect(THEME_MODES).toEqual(['system', 'light', 'dark']);
    expect(DEFAULT_THEME_MODE).toBe('system');
  });

  it('resolves a forced light/dark preference verbatim', () => {
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  it('resolves system mode from the OS prefers-color-scheme', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
  });

  it('systemPrefersDark reads matchMedia without throwing in jsdom', () => {
    // The setup.js stub returns matches:false by default.
    expect(typeof systemPrefersDark()).toBe('boolean');
  });

  it('applyThemeToDocument writes data-theme + color-scheme on <html>', () => {
    applyThemeToDocument('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().style.colorScheme).toBe('dark');

    applyThemeToDocument('light');
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(html().style.colorScheme).toBe('light');
  });

  it('cssVar falls back when the custom property is undefined', () => {
    // No stylesheet is loaded in jsdom, so an unset token must fall back.
    expect(cssVar('--does-not-exist-r9', '#123456')).toBe('#123456');
    // An inline custom property IS visible to getComputedStyle in jsdom.
    html().style.setProperty('--r9-test-token', '#abcdef');
    expect(cssVar('--r9-test-token', '#000000')).toBe('#abcdef');
  });

  // ---- #19: brand accent ----
  it('pins the brand accent to PRD #C62828 (never an antd default)', () => {
    expect(BRAND_PRIMARY).toBe('#C62828');

    const light = antdThemeConfig('light', antdTheme);
    expect(light.token.colorPrimary).toBe('#C62828');
    expect(light.algorithm).toBe(antdTheme.defaultAlgorithm);

    const dark = antdThemeConfig('dark', antdTheme);
    expect(dark.token.colorPrimary).toBe('#C62828');
    expect(dark.algorithm).toBe(antdTheme.darkAlgorithm);
  });
});

describe('ThemedApp theme host', () => {
  it('defaults to the resolved system theme on first mount', async () => {
    window.electronAPI = makeElectronAPI({});
    render(<ThemedApp />);
    // setup.js matchMedia stub reports matches:false => light.
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('light');
    });
  });

  it('restores a persisted dark preference after mount', async () => {
    window.electronAPI = makeElectronAPI({ theme: 'dark' });
    render(<ThemedApp />);
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('dark');
    });
  });

  it('persisted "light" forces light even when the OS prefers dark', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false
    }));
    try {
      window.electronAPI = makeElectronAPI({ theme: 'light' });
      render(<ThemedApp />);
      await waitFor(() => {
        expect(html().getAttribute('data-theme')).toBe('light');
      });
    } finally {
      window.matchMedia = original;
    }
  });

  it('follows the OS scheme while in "system" mode', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false
    }));
    try {
      window.electronAPI = makeElectronAPI({ theme: 'system' });
      render(<ThemedApp />);
      await waitFor(() => {
        expect(html().getAttribute('data-theme')).toBe('dark');
      });
    } finally {
      window.matchMedia = original;
    }
  });

  it('flips the live theme when a theme:set menu event arrives', async () => {
    window.electronAPI = makeElectronAPI({ theme: 'dark' });
    render(<ThemedApp />);
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('dark');
    });

    // View > 主题 > 浅色 click arrives as theme:set {theme:'light'}.
    await act(async () => {
      menuHandlers.forEach(h => h({ action: 'theme:set', payload: { theme: 'light' } }));
    });
    expect(html().getAttribute('data-theme')).toBe('light');

    // And back to dark.
    await act(async () => {
      menuHandlers.forEach(h => h({ action: 'theme:set', payload: { theme: 'dark' } }));
    });
    expect(html().getAttribute('data-theme')).toBe('dark');
  });

  it('ignores theme:set payloads with an invalid mode', async () => {
    window.electronAPI = makeElectronAPI({ theme: 'light' });
    render(<ThemedApp />);
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('light');
    });
    await act(async () => {
      menuHandlers.forEach(h => h({ action: 'theme:set', payload: { theme: 'neon' } }));
    });
    // Unchanged.
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  // ---- #19: brand accent reaches antd's generated styles ----
  it('themes antd with the brand red instead of its default blue', async () => {
    window.electronAPI = makeElectronAPI({ theme: 'light' });
    render(<ThemedApp />);
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('light');
    });

    // antd v5 injects its design-token CSS into <style> tags. In jsdom the
    // app's own index.css is NOT loaded and no component hard-codes a hex, so
    // the brand red can only appear here when ConfigProvider's colorPrimary
    // seed was applied — a direct regression guard for #19.
    const css = Array.from(document.querySelectorAll('style'))
      .map(el => el.textContent || '')
      .join('\n')
      .toLowerCase();
    expect(css).toContain('.ant-btn-primary');
    expect(css).toMatch(/#c62828|rgb\(198,\s*40,\s*40\)/);
  });
});
