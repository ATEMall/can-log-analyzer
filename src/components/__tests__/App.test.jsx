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
  // #11 (v2.1.1): >100MB ASC cache-compression progress events.
  onCacheCompressProgress: vi.fn(() => () => {}),
  openExternal: vi.fn().mockResolvedValue({ success: true }),
  // R5/R6: project + preferences surface
  saveProject: vi.fn().mockResolvedValue({ success: false }),
  openProject: vi.fn().mockResolvedValue({ success: false }),
  exportLogCSV: vi.fn().mockResolvedValue({ success: false }),
  getSettings: vi.fn().mockResolvedValue({}),
  setSettings: vi.fn().mockResolvedValue({ success: true }),
  onProjectOpenRequest: vi.fn(() => () => {}),
  // R11: global search index + timeline buckets.
  searchQuery: vi.fn().mockResolvedValue({
    success: true,
    result: { kind: 'none', matchCount: 0, matchedIds: [], firstIndex: null, nameMatches: [] }
  }),
  timelineBuckets: vi.fn().mockResolvedValue({ success: false }),
  // R12: main-process bus statistics + aggregated CSV export.
  busStats: vi.fn().mockResolvedValue({ success: false }),
  exportStatsCSV: vi.fn().mockResolvedValue({ success: true }),
  // R14: diagnostics — renderer failures go to the daily log, and the error
  // drawer can copy a sanitized blurb / reveal the log folder.
  logDiagnostic: vi.fn().mockResolvedValue({ success: true }),
  openDiagnosticLog: vi.fn().mockResolvedValue({ success: true, dir: 'C:/diag/logs' }),
  getDiagnosticInfo: vi.fn().mockResolvedValue({
    success: true,
    info: {
      version: '2.2.0',
      platform: 'win32',
      arch: 'x64',
      electron: '31.0.0',
      node: '20.11.0',
      logDir: 'C:/Users/me/AppData/Roaming/can-log-analyzer/logs',
      logPath: 'C:/Users/me/AppData/Roaming/can-log-analyzer/logs/app-2026-09-15.log',
      retentionDays: 7,
      sessionStart: '2026-09-15T02:00:00.000Z',
      uptimeSec: 42
    }
  })
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
  // R12: these two spies are asserted by call count, and the shared
  // mockElectronAPI object keeps its history across tests — reset them here.
  mockElectronAPI.busStats.mockClear();
  mockElectronAPI.exportStatsCSV.mockClear();
  // R14: same shared-object caveat — clear the diagnostics spies per test.
  mockElectronAPI.logDiagnostic.mockClear();
  mockElectronAPI.openDiagnosticLog.mockClear();
  mockElectronAPI.getDiagnosticInfo.mockClear();
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

describe('R10 collapsible DBC layout + state persistence', () => {
  it('renders a collapsed rail when the persisted flag is set, then expands on click', async () => {
    mockElectronAPI.getSettings.mockResolvedValueOnce({ dbcPanelCollapsed: true });
    render(<App />);

    // Persisted collapsed state: only the narrow rail is visible.
    const rail = await screen.findByTestId('dbc-panel-collapsed');
    expect(rail).toBeTruthy();
    expect(screen.queryByTestId('dbc-panel')).toBeNull();

    // Clicking the rail (or the round toggle) expands and persists.
    await act(async () => {
      fireEvent.click(screen.getByTestId('dbc-collapse-toggle'));
    });
    expect(screen.getByTestId('dbc-panel')).toBeTruthy();
    expect(screen.queryByTestId('dbc-panel-collapsed')).toBeNull();
    const lastCall = mockElectronAPI.setSettings.mock.calls.at(-1)[0];
    expect(lastCall.dbcPanelCollapsed).toBe(false);
  });

  it('collapses the full panel into the rail and persists the choice', async () => {
    render(<App />);
    expect(await screen.findByTestId('dbc-panel')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('dbc-collapse-toggle'));
    });
    expect(screen.getByTestId('dbc-panel-collapsed')).toBeTruthy();
    expect(screen.queryByTestId('dbc-panel')).toBeNull();
    expect(mockElectronAPI.setSettings).toHaveBeenCalledWith({ dbcPanelCollapsed: true });

    // Expanding again flips the flag back and remounts the full panel.
    await act(async () => {
      fireEvent.click(screen.getByTestId('dbc-panel-collapsed'));
    });
    expect(screen.getByTestId('dbc-panel')).toBeTruthy();
    expect(mockElectronAPI.setSettings).toHaveBeenCalledWith({ dbcPanelCollapsed: false });
  });

  it('restores the persisted panel width inside the new 15%–45% range', async () => {
    mockElectronAPI.getSettings.mockResolvedValueOnce({ panelWidth: 30 });
    render(<App />);
    const panel = await screen.findByTestId('dbc-panel');
    // React inlines the percentage width on the container.
    expect(panel.style.width).toBe('30%');
  });

  it('R11: global search sends the query to the main-process index and Enter locates', async () => {
    mockElectronAPI.searchQuery.mockResolvedValueOnce({
      success: true,
      result: {
        kind: 'id',
        matchCount: 3,
        matchedIds: [0x123],
        firstIndex: 2,
        firstTimestamp: 0.003,
        nameMatches: []
      }
    });

    render(<App />);

    // Ctrl+F focuses the global search box (keyboard shortcut wiring).
    await act(async () => {
      fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: '0x123' } });
    });

    await waitFor(() => expect(mockElectronAPI.searchQuery).toHaveBeenCalledTimes(1));
    const payload = mockElectronAPI.searchQuery.mock.calls[0][0];
    expect(payload.query).toBe('0x123');
    expect(payload.scope).toBe('all');
    expect(payload.dbcMessages).toEqual([]);

    // The hit count is surfaced next to the input.
    expect(screen.getByTestId('global-search-count').textContent).toBe('3 hits');

    // Enter switches to the log tab and hands the locate target to MessageTable.
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('global-search-input'), { key: 'Enter' });
    });
    expect(await screen.findByText('导出为 CSV')).toBeTruthy();
    expect(mockElectronAPI.setSettings).toHaveBeenCalledWith({ lastTab: 'log' });
  });

  it('R11: Esc clears the global search', async () => {
    render(<App />);
    await act(async () => {
      fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'abc' } });
    });
    expect(screen.getByTestId('global-search-input').value).toBe('abc');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByTestId('global-search-input').value).toBe('');
  });

  it('restores persisted DBC message expansion after the database loads', async () => {
    mockElectronAPI.getSettings.mockResolvedValueOnce({ dbcExpanded: { 256: true } });
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/dbc/test.dbc');
    mockElectronAPI.loadDBC.mockResolvedValueOnce({
      success: true,
      messages: [{
        id: 256, name: 'MsgA', sender: 'VCU', dlc: 8,
        signals: [{ name: 'SigA', startBit: 0, length: 8, byteOrder: 'little', factor: 1, offset: 0 }]
      }],
      rawContent: 'BO_ ...'
    });

    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-load-dbc'));
    });
    // The saved expansion (id 256 = true) is re-applied once messages exist,
    // so MsgA's signal rows are already expanded after the load.
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('加载成功，共 1 条消息，1 个信号');
    });
    expect(screen.getByText('SigA')).toBeTruthy();

    // Collapsing that row persists the updated expansion map back to settings.
    await act(async () => {
      fireEvent.click(screen.getByText('MsgA'));
    });
    const call = mockElectronAPI.setSettings.mock.calls.at(-1)[0];
    expect(call.dbcExpanded).toEqual({ 256: false });
  });
});

describe('R12 bus statistics wiring', () => {
  // A tiny two-frame log plus the aggregated statistics the main process would
  // return for it (load curve / cycle table / error frames).
  async function loadLogWithStats() {
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/logs/a.asc');
    mockElectronAPI.loadASC.mockResolvedValueOnce({
      success: true,
      messages: [
        { timestamp: 0.0, id: 0x100, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0] },
        { timestamp: 0.01, id: 0x100, direction: 'Rx', dlc: 8, data: [1, 0, 0, 0, 0, 0, 0, 0] }
      ],
      headerLines: [],
      parseErrors: [],
      parseErrorCount: 0,
      errorFrames: [{ timestamp: 1.5, channel: 1, kind: 'error-frame', category: 'stuff' }],
      totalCount: 2
    });
    mockElectronAPI.getStats.mockResolvedValueOnce({ size: 2048 });
    mockElectronAPI.busStats.mockResolvedValueOnce({
      success: true,
      totalFrames: 2,
      load: {
        bitrate: 500000, tStart: 0, tEnd: 1, interval: 1, duration: 1,
        avg: 12.34, peak: 45.6, peakTime: 0,
        points: [{ t: 0, load: 45.6, frames: 2 }]
      },
      cycles: {
        tolerancePct: 10,
        totalIds: 1,
        rows: [{
          id: 0x100, name: 'MsgA', count: 2, firstIndex: 1,
          expected: 10, avgPeriod: 10, minPeriod: 10, maxPeriod: 10,
          maxJitter: 0, avgJitter: 0, overCount: 0, overRatio: 0
        }]
      },
      errors: {
        total: 1,
        busOffCount: 0,
        byKind: [{ kind: 'stuff', count: 1 }],
        events: [{ timestamp: 1.5, channel: 1, kind: 'error-frame', category: 'stuff' }],
        states: []
      }
    });

    render(<App />);
    await act(async () => { fireEvent.click(screen.getByText('加载 ASC')); });
    await waitFor(() => expect(mockElectronAPI.busStats).toHaveBeenCalledTimes(1));
  }

  it('asks the main process for statistics and renders them in the 总线统计 tab', async () => {
    await loadLogWithStats();

    const payload = mockElectronAPI.busStats.mock.calls[0][0];
    expect(payload.bitrate).toBe(500000);
    expect(payload.tolerancePct).toBe(10);
    expect(payload.errorFrames).toHaveLength(1);
    expect(payload.filePath).toBe('C:/logs/a.asc');

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /总线统计/ }));
    });
    expect(screen.getByTestId('stats-load-avg').textContent).toBe('12.3%');
    expect(screen.getByTestId('stats-panel-error-total').textContent).toBe('1');
  });

  it('clicking a cycle row switches to the log tab and locates the first frame', async () => {
    await loadLogWithStats();

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /总线统计/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('stats-cycle-row-256'));
    });

    // The log tab is active again (its export buttons are on screen) and the
    // tab choice is persisted for the next launch.
    expect(await screen.findByText('导出为 CSV')).toBeTruthy();
    expect(mockElectronAPI.setSettings).toHaveBeenCalledWith({ lastTab: 'log' });
  });

  it('exports the aggregated statistics as CSV', async () => {
    await loadLogWithStats();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /总线统计/ }));
    });

    mockElectronAPI.saveFile.mockResolvedValueOnce('C:/logs/a_stats.csv');
    await act(async () => {
      fireEvent.click(screen.getByTestId('stats-export-csv'));
    });

    expect(mockElectronAPI.exportStatsCSV).toHaveBeenCalledTimes(1);
    const [path, stats] = mockElectronAPI.exportStatsCSV.mock.calls[0];
    expect(path).toBe('C:/logs/a_stats.csv');
    expect(stats.load.peak).toBeCloseTo(45.6, 6);
    expect(stats.cycles.rows[0].id).toBe(0x100);
  });
});

describe('R14 diagnostics wiring', () => {
  it('forwards window.onerror to the main-process diagnostic log', async () => {
    render(<App />);
    await act(async () => {
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'boom in renderer', filename: 'app.js', lineno: 12, colno: 3
      }));
    });

    expect(mockElectronAPI.logDiagnostic).toHaveBeenCalledTimes(1);
    const entry = mockElectronAPI.logDiagnostic.mock.calls[0][0];
    expect(entry.level).toBe('error');
    expect(entry.event).toBe('window.onerror');
    expect(entry.detail.message).toBe('boom in renderer');
    expect(entry.detail.lineno).toBe(12);
  });

  it('forwards unhandledrejection to the main-process diagnostic log', async () => {
    render(<App />);
    const evt = new Event('unhandledrejection');
    evt.reason = new Error('async boom');
    await act(async () => {
      window.dispatchEvent(evt);
    });

    expect(mockElectronAPI.logDiagnostic).toHaveBeenCalledTimes(1);
    const entry = mockElectronAPI.logDiagnostic.mock.calls[0][0];
    expect(entry.event).toBe('unhandledrejection');
    expect(entry.detail.message).toBe('async boom');
    expect(entry.detail.stack).toContain('async boom');
  });

  it('copies a sanitized diagnostics blurb (counts only, no payloads)', async () => {
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/logs/with-errors.asc');
    mockElectronAPI.loadASC.mockResolvedValueOnce({
      success: true,
      messages: [{ timestamp: 0, id: 0x123, direction: 'Rx', dlc: 8, data: [1, 2, 3, 4, 5, 6, 7, 8] }],
      headerLines: [],
      parseErrors: [
        { lineNumber: 12, line: '0.001000 1 789 Rx d 8 ZZ YY XX', reason: '无法解析的数据行（格式不识别或数据损坏）' },
        { lineNumber: 13, line: '0.002000 1 790 Rx d 8 ??', reason: '无法解析的数据行（格式不识别或数据损坏）' }
      ],
      parseErrorCount: 2,
      totalCount: 1
    });
    mockElectronAPI.getStats.mockResolvedValueOnce({ size: 4096, lines: 20 });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<App />);
    await act(async () => { fireEvent.click(screen.getByText('加载 ASC')); });
    const badge = await screen.findByTestId('parse-error-badge');
    await act(async () => { fireEvent.click(badge); });

    await act(async () => { fireEvent.click(screen.getByTestId('copy-diagnostics')); });

    expect(mockElectronAPI.getDiagnosticInfo).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0];
    expect(text).toContain('CAN Log Analyzer Pro 诊断信息');
    expect(text).toContain('应用版本: v2.2.0');
    expect(text).toContain('日志保留: 7 天');
    expect(text).toContain('日志源: with-errors.asc（1 帧）');
    expect(text).toContain('解析错误: 2 条');
    expect(text).toContain('无法解析的数据行（格式不识别或数据损坏） ×2');
    // Desensitized: neither the damaged line text nor the frame payload leaks.
    expect(text).not.toContain('ZZ YY XX');
    expect(text).not.toContain('日志源: C:/logs');
    expect(message.success).toHaveBeenCalledWith('诊断信息已复制到剪贴板');
  });

  it('opens the diagnostic log folder from the error drawer', async () => {
    mockElectronAPI.openFile.mockResolvedValueOnce('C:/logs/with-errors.asc');
    mockElectronAPI.loadASC.mockResolvedValueOnce({
      success: true,
      messages: [{ timestamp: 0, id: 0x123, direction: 'Rx', dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0] }],
      headerLines: [],
      parseErrors: [{ lineNumber: 3, line: 'bad', reason: '无法解析的数据行' }],
      parseErrorCount: 1,
      totalCount: 1
    });
    mockElectronAPI.getStats.mockResolvedValueOnce({ size: 4096, lines: 20 });

    render(<App />);
    await act(async () => { fireEvent.click(screen.getByText('加载 ASC')); });
    const badge = await screen.findByTestId('parse-error-badge');
    await act(async () => { fireEvent.click(badge); });
    await act(async () => { fireEvent.click(screen.getByTestId('open-diagnostic-log')); });

    expect(mockElectronAPI.openDiagnosticLog).toHaveBeenCalledTimes(1);
  });
});

