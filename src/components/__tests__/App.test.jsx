import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react';
// The static antd `message` API mounts a singleton holder into the document;
// across tests in jsdom that holder leaks DOM and breaks text queries. We spy
// on the message methods instead, so toasts never render and we assert on the
// call args (which is what the wiring tests actually care about).
import { message } from 'antd';
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
  openExternal: vi.fn().mockResolvedValue({ success: true }),
  // R5/R6: project + preferences surface
  saveProject: vi.fn().mockResolvedValue({ success: false }),
  openProject: vi.fn().mockResolvedValue({ success: false }),
  exportLogCSV: vi.fn().mockResolvedValue({ success: false }),
  getSettings: vi.fn().mockResolvedValue({}),
  setSettings: vi.fn().mockResolvedValue({ success: true }),
  onProjectOpenRequest: vi.fn(() => () => {})
};

beforeEach(() => {
  menuHandlers = [];
  window.electronAPI = mockElectronAPI;
  // Replace the toast methods with no-op spies — no DOM is produced, so tests
  // can assert on the exact toast payload without jsdom holder leakage. Each
  // spyOn wraps the previous test's spy, so call history is per-test.
  vi.spyOn(message, 'success').mockImplementation(() => {});
  vi.spyOn(message, 'error').mockImplementation(() => {});
  vi.spyOn(message, 'warning').mockImplementation(() => {});
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
      menuHandlers.forEach(h => h({ action: 'help:open' }));
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
      menuHandlers.forEach(h => h({ action: 'tool:clear' }));
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

  it('R5: "file:save-project" writes a claproj payload with sources + selection', async () => {
    // Load a DBC so there is something to save.
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/dbc/test.dbc');
    mockElectronAPI.loadDBC.mockResolvedValueOnce({
      success: true,
      messages: [
        { id: 0x100, name: 'MsgA', signals: [{ name: 'SigA' }] },
        { id: 0x200, name: 'MsgB', signals: [{ name: 'SigB' }] }
      ],
      rawContent: 'BO_ ...'
    });
    render(<App />);
    await act(async () => { fireEvent.click(screen.getByTestId('toolbar-load-dbc')); });
    // The DBC toast confirms the load completed before we save the project.
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('加载成功，共 2 条消息，2 个信号');
    });

    mockElectronAPI.saveFile.mockResolvedValueOnce('C:/proj/test.claproj');
    await act(async () => { menuHandlers.forEach(h => h({ action: 'file:save-project' })); });

    expect(mockElectronAPI.saveProject).toHaveBeenCalledTimes(1);
    const [path, data] = mockElectronAPI.saveProject.mock.calls[0];
    expect(path).toBe('C:/proj/test.claproj');
    expect(data.format).toBe('claproj');
    expect(data.databases[0].path).toBe('C:/dbc/test.dbc');
    expect(data.selection.msgIds).toEqual([0x100, 0x200]);
  });

  it('R5: "file:open-project" re-loads log/DBC and restores the selection', async () => {
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/proj/test.claproj');
    mockElectronAPI.openProject.mockResolvedValueOnce({
      success: true,
      project: {
        format: 'claproj',
        version: 1,
        logs: [{ type: 'asc', path: 'C:/logs/a.asc' }],
        databases: [{ path: 'C:/dbc/test.dbc' }],
        selection: {
          msgIds: [0x100, 0x200],
          signals: [{ key: '256::SigA', msgId: 0x100, signalName: 'SigA' }]
        },
        filters: {},
        activeTab: 'signal',
        sampleStep: 1
      }
    });
    mockElectronAPI.loadDBC.mockResolvedValueOnce({
      success: true,
      messages: [
        { id: 0x100, name: 'MsgA', signals: [{ name: 'SigA' }] },
        { id: 0x200, name: 'MsgB', signals: [{ name: 'SigB' }] }
      ],
      rawContent: 'BO_ ...'
    });
    mockElectronAPI.loadASC.mockResolvedValueOnce({
      success: true,
      messages: [{ timestamp: 0, id: 0x100, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0] }],
      headerLines: [],
      parseErrors: [],
      parseErrorCount: 0,
      totalCount: 1
    });
    mockElectronAPI.getStats.mockResolvedValueOnce({ size: 4096 });

    render(<App />);
    await act(async () => { menuHandlers.forEach(h => h({ action: 'file:open-project' })); });

    // The log is re-loaded and the persisted signal selection is re-applied.
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('加载成功，共 1 条消息');
    });
    // The count lives in a nested <b>, so match the label then check textContent.
    expect(screen.getByText('已选信号').textContent).toContain('1');
  });

  it('R7: the log-tab CSV export hands the messages + name map to the main process', async () => {
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/logs/a.asc');
    mockElectronAPI.loadASC.mockResolvedValueOnce({
      success: true,
      messages: [{ timestamp: 0, id: 0x100, direction: 'Rx', dlc: 8, data: [1, 2, 3, 4, 5, 6, 7, 8] }],
      headerLines: [],
      parseErrors: [],
      parseErrorCount: 0,
      totalCount: 1
    });
    mockElectronAPI.getStats.mockResolvedValueOnce({ size: 4096 });
    mockElectronAPI.loadDBC.mockResolvedValueOnce({
      success: true,
      messages: [{ id: 0x100, name: 'MsgA', signals: [] }],
      rawContent: 'BO_ ...'
    });

    render(<App />);
    await act(async () => { fireEvent.click(screen.getByText('加载 ASC')); });
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('加载成功，共 1 条消息');
    });
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/dbc/test.dbc');
    await act(async () => { fireEvent.click(screen.getByTestId('toolbar-load-dbc')); });
    // Wait for the DBC load so the name map (MsgA) is populated before export.
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('加载成功，共 1 条消息，0 个信号');
    });
    // The export buttons live in the CAN 报文日志 tab.
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /CAN 报文日志/ }));
    });

    mockElectronAPI.saveFile.mockResolvedValueOnce('C:/logs/a_filtered.csv');
    await act(async () => { fireEvent.click(screen.getByText('导出为 CSV')); });

    expect(mockElectronAPI.exportLogCSV).toHaveBeenCalledTimes(1);
    // The renderer suggests `<源>_filtered_<timestamp>.csv` as the default name.
    const lastSaveFileCall = mockElectronAPI.saveFile.mock.calls.at(-1);
    expect(lastSaveFileCall[0]).toMatch(/a_filtered_\d+\.csv$/);
    const [path, messages, nameMap] = mockElectronAPI.exportLogCSV.mock.calls[0];
    expect(path).toBe('C:/logs/a_filtered.csv');
    expect(messages).toHaveLength(1);
    expect(nameMap[0x100]).toBe('MsgA');
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

    // Wait for the load to complete (its success toast is a no-op spy).
    await waitFor(() => {
      expect(message.success).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('parse-error-badge')).toBeNull();
  });
});
