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
  exportText: vi.fn().mockResolvedValue({ success: true }),
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

describe('R4 parse-error reporting UI', () => {
  it('shows the warning badge, opens the drawer and exports the report', async () => {
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/logs/with-errors.asc');
    mockElectronAPI.loadASC.mockResolvedValueOnce({
      success: true,
      messages: [{ timestamp: 0, id: 0x123, direction: 'Rx', dlc: 8, data: [1, 2, 3, 4, 5, 6, 7, 8] }],
      headerLines: ['base hex  timestamps absolute'],
      parseErrors: [
        { lineNumber: 12, line: '0.001000 1 789 Rx d 8 ZZ YY XX', reason: '无法解析的数据行（格式不识别或数据损坏）' },
        { lineNumber: 13, line: '0.002000 1 790 Rx d 8 ??', reason: '无法解析的数据行（格式不识别或数据损坏）' }
      ],
      parseErrorCount: 2,
      totalCount: 1
    });
    mockElectronAPI.getStats.mockResolvedValueOnce({ size: 4096, lines: 20 });

    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByText('加载 ASC'));
    });

    // Yellow warning badge appears after the load completes.
    const badge = await screen.findByTestId('parse-error-badge');
    expect(badge.textContent).toMatch(/2 行错误/);

    // Clicking it opens the error report drawer listing each damaged line.
    await act(async () => {
      fireEvent.click(badge);
    });
    expect(screen.getByTestId('parse-error-item-0').textContent).toMatch(/行 12/);
    expect(screen.getByTestId('parse-error-item-1').textContent).toMatch(/行 13/);

    // Export button hands the serialized report to the exportText IPC.
    mockElectronAPI.saveFile.mockResolvedValueOnce('C:/logs/parse_errors.txt');
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-parse-errors'));
    });
    expect(mockElectronAPI.exportText).toHaveBeenCalledTimes(1);
    const [, content] = mockElectronAPI.exportText.mock.calls[0];
    expect(content).toContain('解析错误报告');
    expect(content).toContain('错误总数: 2');
    expect(content).toContain('[行 12]');
    expect(content).toContain('ZZ YY XX');
  });

  it('hides the badge when the load reports no parse errors', async () => {
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/logs/clean.asc');
    mockElectronAPI.loadASC.mockResolvedValueOnce({
      success: true,
      messages: [{ timestamp: 0, id: 0x123, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0] }],
      headerLines: [],
      parseErrors: [],
      parseErrorCount: 0,
      totalCount: 1
    });
    mockElectronAPI.getStats.mockResolvedValueOnce({ size: 4096, lines: 20 });

    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByText('加载 ASC'));
    });

    await screen.findByText(/加载成功/);
    expect(screen.queryByTestId('parse-error-badge')).toBeNull();
  });
});
