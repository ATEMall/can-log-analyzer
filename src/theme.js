import React, { useState, useEffect } from 'react';

// =====================================================================
// v2.2 R9 — theme core.
//
// The renderer stores a *mode* preference ('system' | 'light' | 'dark')
// in settings.json (`theme` key, owned by the main process). The
// *resolved* theme is the actual 'light'/'dark' applied to the UI:
//
//   system -> prefers-color-scheme (Electron maps it to nativeTheme,
//             so the app follows the OS automatically)
//   light/dark -> forced
//
// The resolved theme is applied by:
//   1. setting <html data-theme="light|dark">   -> drives the CSS design
//      tokens defined in index.css ([data-theme='dark'] overrides);
//   2. feeding antd's ConfigProvider algorithm (darkAlgorithm / default).
// =====================================================================

export const THEME_MODES = ['system', 'light', 'dark'];
export const DEFAULT_THEME_MODE = 'system';
export const THEME_SETTING_KEY = 'theme';

// Brand accent seed (PRD §5.3: 红 #C62828 + 白). Single source of truth shared
// by the CSS token (index.css `--brand`) and antd's `colorPrimary` seed, so the
// platform brand colour can never silently fall back to an antd default.
export const BRAND_PRIMARY = '#C62828';

/**
 * antd ConfigProvider theme config for a resolved light|dark theme. Pins
 * `colorPrimary` to the brand red (antd defaults to blue otherwise) while
 * switching the algorithm for dark mode.
 */
export function antdThemeConfig(resolved, antdTheme) {
  const { defaultAlgorithm, darkAlgorithm } = antdTheme || {};
  return {
    algorithm: resolved === 'dark' ? darkAlgorithm : defaultAlgorithm,
    token: { colorPrimary: BRAND_PRIMARY }
  };
}

/** Does the OS currently ask for a dark colour scheme? */
export function systemPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return !!window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Resolve a stored mode preference into a concrete light|dark theme. */
export function resolveThemeMode(mode, prefersDark = systemPrefersDark()) {
  if (mode === 'light' || mode === 'dark') return mode;
  return prefersDark ? 'dark' : 'light';
}

/** Convenience: is the resolved theme dark? */
export function isDarkTheme(mode, prefersDark = systemPrefersDark()) {
  return resolveThemeMode(mode, prefersDark) === 'dark';
}

/** Apply the resolved theme to the document root (data-theme + color-scheme). */
export function applyThemeToDocument(resolved) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
}

/**
 * Read a CSS custom property off <html>.
 * SVG presentation attributes (recharts grid stroke, axis tick fill...) do
 * NOT accept var(), so components read the computed value instead — index.css
 * stays the single source of truth for token values.
 */
export function cssVar(name, fallback = '') {
  if (typeof document === 'undefined') return fallback;
  const root = document.documentElement;
  if (!root || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  return value || fallback;
}

// Chart-neutral tokens recharts needs as concrete SVG colours, plus their
// light defaults (mirror of index.css). Dark values come from the stylesheet.
export const CHART_CSS_VARS = {
  grid: '--chart-grid',
  axisText: '--text-quiet'
};
export const CHART_TOKEN_DEFAULTS = {
  '--chart-grid': '#f0f0f0',
  '--text-quiet': '#8c8c8c'
};

function readThemeTokens(tokenNames, defaults) {
  const map = {};
  for (const name of tokenNames) {
    map[name] = cssVar(name, defaults && defaults[name]);
  }
  return map;
}

/**
 * React hook: resolve a set of design tokens to concrete values, refreshed
 * whenever <html data-theme> flips. Components that must hand colours to
 * SVG / DOM APIs (recharts) use this instead of hard-coding hex values.
 */
export function useThemeTokens(tokenNames, defaults) {
  const key = Array.isArray(tokenNames) ? tokenNames.join(',') : String(tokenNames);
  const [map, setMap] = useState(() => readThemeTokens(key ? key.split(',') : [], defaults));

  useEffect(() => {
    const apply = () => setMap(readThemeTokens(key ? key.split(',') : [], defaults));
    apply();
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}
