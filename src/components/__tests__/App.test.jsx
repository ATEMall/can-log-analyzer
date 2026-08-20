import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import App from '../../App';

// Mock the electronAPI surface that App.jsx actually subscribes to at mount.
// We deliberately keep the implementation tiny so the test stays focused on
// the menu-event routing path: Help > 使用手册 opens the HelpModal, and
// Tool > 清空 wipes the loaded data set.
let menuHandlers = [];
const mockElectronAPI = {
  getCRCAlgorithms: vi.fn().mockResolvedValue([]),
  onMenuEvent: vi.fn((cb) => {
    menuHandlers.push(cb);
    return () => { menuHandlers = menuHandlers.filter(h => h !== cb); };
  }),
  // Surface just enough of the remaining API to keep App.jsx from crashing
  // during the first render pass; values are irrelevant for these tests.
  openFile: vi.fn().mockResolvedValue(null),
  saveFile: vi.fn().mockResolvedValue(null),
  loadDBC: vi.fn().mockResolvedValue({ success: false }),
  loadASC: vi.fn().mockResolvedValue({ success: false }),
  loadBLF: vi.fn().mockResolvedValue({ success: false }),
  exportASC: vi.fn().mockResolvedValue({ success: false }),
  convertASCtoBLF: vi.fn().mockResolvedValue({ success: false }),
  getStats: vi.fn().mockResolvedValue(null),
  loadPhysicalCSV: vi.fn().mockResolvedValue({ success: false }),
  convertCSVtoASC: vi.fn().mockResolvedValue({ success: false }),
  decodeSignalFrames: vi.fn().mockResolvedValue({ success: false }),
  exportSignalCSV: vi.fn().mockResolvedValue({ success: false }),
  onExportProgress: vi.fn(() => () => {}),
  openExternal: vi.fn().mockResolvedValue({ success: true })
};

beforeEach(() => {
  menuHandlers = [];
  window.electronAPI = mockElectronAPI;
  // antd message calls in jsdom warn loudly; silence by stubbing the API.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('App menu wiring', () => {
  it('subscribes to menu events on mount', () => {
    render(<App />);
    expect(mockElectronAPI.onMenuEvent).toHaveBeenCalledTimes(1);
  });

  it('"help:open" menu action opens the in-window HelpModal', async () => {
    render(<App />);
    // Initially the modal is closed.
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      menuHandlers.forEach(h => h('help:open'));
    });

    // After dispatching the help:open menu action, a dialog (antd Modal)
    // is mounted. The HelpModal title is "CAN Log Analyzer Pro 使用手册".
    const dialog = screen.queryByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toMatch(/使用手册/);
  });

  it('"tool:clear" menu action is a safe noop when no data is loaded', async () => {
    // Render with no data: triggering tool:clear must not throw and must
    // not display the "已清空所有数据" success toast either (it would imply
    // we tried to clear phantom state). We just check the render is stable.
    render(<App />);
    await act(async () => {
      menuHandlers.forEach(h => h('tool:clear'));
    });
    // Header counter is still rendered, app did not crash.
    expect(screen.getByText('CAN Log Analyzer')).toBeTruthy();
  });
});
