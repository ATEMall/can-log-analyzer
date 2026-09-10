import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { message } from 'antd';
import ThemedApp from '../ThemedApp';
import {
  THEME_MODES, DEFAULT_THEME_MODE,
  resolveThemeMode, systemPrefersDark, applyThemeToDocument, cssVar
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
});
