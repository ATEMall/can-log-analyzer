import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Layout, Typography, message, Progress,
  Button, Space, Tabs, Modal, Tag, Input, Drawer, List, Empty
} from 'antd';
import {
  DatabaseOutlined,
  TableOutlined, SyncOutlined, ThunderboltOutlined,
  SearchOutlined, WarningOutlined, DownloadOutlined
} from '@ant-design/icons';
import DBCPanel from './components/DBCPanel';
import MessageTable from './components/MessageTable';
import ExportPanel from './components/ExportPanel';
import CSVPanel from './components/CSVPanel';
import SignalParsePanel from './components/SignalParsePanel';
import HelpModal from './components/HelpModal';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

function App() {
  // ======= State =======
  const [ascFile, setAscFile] = useState(null);
  const [blfFile, setBlfFile] = useState(null);
  const [dbcMessages, setDbcMessages] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadedMessages, setLoadedMessages] = useState([]);
  const [headerLines, setHeaderLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Signal-level selection state
  const [selectedSignals, setSelectedSignals] = useState([]);

  // Raw DBC content for viewer
  const [dbcRawContent, setDbcRawContent] = useState('');
  const [rawModalOpen, setRawModalOpen] = useState(false);

  // R5: DBC source file path — tracked so projects can re-load and restore it.
  const [dbcFile, setDbcFile] = useState(null);

  // R8: left DBC panel width (%) — draggable splitter, persisted in settings.
  const [panelWidth, setPanelWidth] = useState(46);
  const panelWidthRef = useRef(46);

  // Physical CSV state
  const [csvData, setCsvData] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [crcAlgorithms, setCrcAlgorithms] = useState([]);
  const [selectedCRC, setSelectedCRC] = useState('NONE');
  const [convertProgress, setConvertProgress] = useState(0);

  // Active tab (default: signal parse results as main view)
  const [activeTab, setActiveTab] = useState('signal');

  // Help manual dialog
  const [helpOpen, setHelpOpen] = useState(false);

  // Search state for DBC messages/signals (shared so the input sits in the top
  // toolbar while DBCPanel consumes it for filtering).
  const [dbcSearch, setDbcSearch] = useState('');

  // R4: parse error reporting (ASC data lines / BLF bad blocks that were
  // skipped without aborting the load).
  const [parseErrors, setParseErrors] = useState([]);
  const [parseErrorCount, setParseErrorCount] = useState(0);
  const [parseErrorDrawerOpen, setParseErrorDrawerOpen] = useState(false);

  // Load CRC algorithms on mount
  useEffect(() => {
    window.electronAPI?.getCRCAlgorithms().then(algs => {
      setCrcAlgorithms(algs || []);
    }).catch(() => {});
  }, []);

  // ======= Signal Selection Toggle =======
  const handleSignalToggle = useCallback((msgId, signalName) => {
    setSelectedSignals(prev => {
      const key = `${msgId}::${signalName}`;
      const exists = prev.findIndex(s => s.msgId === msgId && s.signalName === signalName);
      if (exists >= 0) {
        return prev.filter((_, i) => i !== exists);
      } else {
        return [...prev, { key, msgId, signalName }];
      }
    });
  }, []);

  // Bulk select all signals
  const handleSignalSelectAll = useCallback(() => {
    if (!dbcMessages || dbcMessages.length === 0) return;
    const allSignals = [];
    for (const msg of dbcMessages) {
      for (const sig of (msg.signals || [])) {
        allSignals.push({
          key: `${msg.id}::${sig.name}`,
          msgId: msg.id,
          signalName: sig.name
        });
      }
    }
    setSelectedSignals(allSignals);
  }, [dbcMessages]);

  // Bulk clear all signal selections
  const handleSignalClearAll = useCallback(() => {
    setSelectedSignals([]);
  }, []);

  // Select all signals of one message (bulk)
  const handleMsgSignalSelectAll = useCallback((msgId) => {
    setSelectedSignals(prev => {
      const msg = dbcMessages.find(m => m.id === msgId);
      if (!msg) return prev;
      const existing = new Set(prev.map(s => `${s.msgId}::${s.signalName}`));
      const toAdd = [];
      for (const sig of (msg.signals || [])) {
        const key = `${msgId}::${sig.name}`;
        if (!existing.has(key)) {
          toAdd.push({ key, msgId, signalName: sig.name });
        }
      }
      if (toAdd.length === 0) return prev;
      return [...prev, ...toAdd];
    });
  }, [dbcMessages]);

  // Clear all signals of one message (bulk)
  const handleMsgSignalClearAll = useCallback((msgId) => {
    setSelectedSignals(prev => prev.filter(s => s.msgId !== msgId));
  }, []);

  // ======= Log / DBC load helpers =======
  // Shared by the open dialogs, the recent-files menu and project restore.
  // R6: every successful load also lands in the main-process recent list.
  const loadLogByPath = useCallback(async (filePath, type) => {
    setLoading(true);
    setProgress(10);
    try {
      message.info(type === 'blf' ? '正在加载 BLF 文件...' : '正在加载 ASC 文件...');
      const result = type === 'blf'
        ? await window.electronAPI.loadBLF(filePath, [])
        : await window.electronAPI.loadASC(filePath, []);
      setProgress(type === 'blf' ? 60 : 50);

      if (result.success) {
        const stats = await window.electronAPI.getStats(filePath);
        if (type === 'blf') {
          setBlfFile({ path: filePath, stats });
          setAscFile(null);
        } else {
          setAscFile({ path: filePath, stats });
          setBlfFile(null);
        }
        setLoadedMessages(result.messages);
        setHeaderLines(result.headerLines);
        setParseErrors(result.parseErrors || []);
        setParseErrorCount(result.parseErrorCount || 0);
        if ((result.parseErrorCount || 0) > 0) {
          message.warning(type === 'blf'
            ? `加载完成：${result.totalCount} 条消息，${result.parseErrorCount} 个损坏对象块已跳过`
            : `加载完成：${result.totalCount} 条消息，${result.parseErrorCount} 行解析错误已跳过`);
        } else {
          message.success(`加载成功，共 ${result.totalCount} 条消息`);
        }
        return true;
      }
      message.error('加载失败: ' + result.error);
      return false;
    } catch (error) {
      message.error('加载失败: ' + error.message);
      return false;
    } finally {
      setLoading(false);
      setProgress(100);
      setTimeout(() => setProgress(0), 500);
    }
  }, []);

  const loadDBCByPath = useCallback(async (filePath) => {
    try {
      message.info('正在解析 DBC 文件...');
      const result = await window.electronAPI.loadDBC(filePath);
      if (result.success) {
        setDbcFile({ path: filePath });
        setDbcMessages(result.messages);
        setSelectedIds(new Set(result.messages.map(m => m.id)));
        setSelectedSignals([]);
        setDbcRawContent(result.rawContent || '');
        const totalSignals = result.messages.reduce((sum, m) => sum + m.signals.length, 0);
        message.success(`加载成功，共 ${result.messages.length} 条消息，${totalSignals} 个信号`);
        return true;
      }
      message.error('加载失败: ' + result.error);
      return false;
    } catch (error) {
      message.error('加载失败: ' + error.message);
      return false;
    }
  }, []);

  // ======= ASC Load =======
  const handleLoadASC = useCallback(async () => {
    const filePath = await window.electronAPI.openFile([
      { name: 'ASC Files', extensions: ['asc'] }
    ]);
    if (!filePath) return;
    await loadLogByPath(filePath, 'asc');
  }, [loadLogByPath]);

  // ======= BLF Load =======
  const handleLoadBLF = useCallback(async () => {
    const filePath = await window.electronAPI.openFile([
      { name: 'BLF Files', extensions: ['blf'] }
    ]);
    if (!filePath) return;
    await loadLogByPath(filePath, 'blf');
  }, [loadLogByPath]);

  // ======= DBC Load =======
  const handleLoadDBC = useCallback(async () => {
    const filePath = await window.electronAPI.openFile([
      { name: 'DBC Files', extensions: ['dbc'] }
    ]);
    if (!filePath) return;
    await loadDBCByPath(filePath);
  }, [loadDBCByPath]);

  // ======= Toggle / Select All (message level) =======
  const handleToggleMessage = useCallback((id) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback((select) => {
    if (select) {
      setSelectedIds(new Set(dbcMessages.map(m => m.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [dbcMessages]);

  // ======= Convert loaded ASC data to BLF =======
  const handleConvertASCtoBLF = useCallback(async () => {
    if (loadedMessages.length === 0) {
      message.warning('请先加载 ASC 日志');
      return;
    }
    try {
      const src = ascFile || blfFile;
      const base = (src?.path || 'log').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'log';
      const defaultName = `${base}_filtered_${Date.now()}.blf`;
      const filePath = await window.electronAPI.saveFile(defaultName, [
        { name: 'BLF Files', extensions: ['blf'] }
      ]);
      if (!filePath) return;

      setLoading(true);
      message.info('正在转换 ASC → BLF...');

      const result = await window.electronAPI.convertASCtoBLF(filePath, loadedMessages);
      if (result.success) {
        const sizeMB = (result.bytes / 1024 / 1024).toFixed(2);
        message.success(`转换成功！已生成 ${result.count} 条报文的 BLF 文件 (${sizeMB} MB)`);
      } else {
        message.error('转换失败: ' + result.error);
      }
    } catch (error) {
      message.error('转换失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [loadedMessages]);

  // ======= Export ASC (from loaded messages) =======
  const handleExportASC = useCallback(async () => {
    if (loadedMessages.length === 0) {
      message.warning('没有可导出的消息');
      return;
    }

    try {
      const src = ascFile || blfFile;
      const base = (src?.path || 'log').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'log';
      const defaultName = `${base}_filtered_${Date.now()}.asc`;
      const filePath = await window.electronAPI.saveFile(defaultName);
      if (!filePath) return;

      setLoading(true);
      message.info('正在导出...');

      const result = await window.electronAPI.exportASC(filePath, headerLines, loadedMessages);

      if (result.success) {
        message.success('导出成功!');
      } else {
        message.error('导出失败: ' + result.error);
      }
    } catch (error) {
      message.error('导出失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [loadedMessages, headerLines]);

  // ======= R7: Export the loaded message log as CSV / BLF =======
  // CSV columns: time,id,name,dir,dlc,data (name = DBC message name when the
  // ID matches a loaded database, otherwise empty). Default filename follows
  // <源>_filtered_<时间戳> so exports never collide with the source log.
  const handleExportLogCSV = useCallback(async () => {
    if (loadedMessages.length === 0) {
      message.warning('没有可导出的消息');
      return;
    }
    const src = ascFile || blfFile;
    const base = (src?.path || 'log').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'log';
    const defaultName = `${base}_filtered_${Date.now()}.csv`;
    const filePath = await window.electronAPI.saveFile(defaultName, [
      { name: 'CSV Files', extensions: ['csv'] }
    ]);
    if (!filePath) return;

    const nameMap = {};
    for (const m of dbcMessages) nameMap[m.id] = m.name;
    setLoading(true);
    message.info('正在导出 CSV...');
    try {
      const result = await window.electronAPI.exportLogCSV(filePath, loadedMessages, nameMap);
      if (result.success) {
        message.success(`导出成功！${result.rowsWritten} 条报文已保存`);
      } else {
        message.error('导出失败: ' + result.error);
      }
    } catch (error) {
      message.error('导出失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [loadedMessages, dbcMessages, ascFile, blfFile]);

  const handleExportBLF = useCallback(async () => {
    if (loadedMessages.length === 0) {
      message.warning('没有可导出的消息');
      return;
    }
    const src = ascFile || blfFile;
    const base = (src?.path || 'log').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'log';
    const defaultName = `${base}_filtered_${Date.now()}.blf`;
    const filePath = await window.electronAPI.saveFile(defaultName, [
      { name: 'BLF Files', extensions: ['blf'] }
    ]);
    if (!filePath) return;

    setLoading(true);
    message.info('正在导出 BLF...');
    try {
      const result = await window.electronAPI.convertASCtoBLF(filePath, loadedMessages);
      if (result.success) {
        const sizeMB = (result.bytes / 1024 / 1024).toFixed(2);
        message.success(`导出成功！已生成 ${result.count} 条报文的 BLF 文件 (${sizeMB} MB)`);
      } else {
        message.error('导出失败: ' + result.error);
      }
    } catch (error) {
      message.error('导出失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [loadedMessages, ascFile, blfFile]);

  // ======= Load Physical CSV =======
  const handleLoadCSV = useCallback(async () => {
    try {
      const filePath = await window.electronAPI.openFile([
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]);
      if (!filePath) return;

      setLoading(true);
      message.info('正在解析物理量 CSV 文件，请稍候...');

      const result = await window.electronAPI.loadPhysicalCSV(filePath);

      if (result.success) {
        const stats = await window.electronAPI.getStats(filePath);
        setCsvFile({ path: filePath, stats });
        setCsvData(result);
        message.success(`CSV 加载成功：${result.totalRows} 行数据，${result.signalCols.filter(c => c && c.msgId !== null).length} 个信号，${result.msgIds.length} 个消息ID`);
        setActiveTab('csv');
      } else {
        message.error('加载失败: ' + result.error);
      }
    } catch (error) {
      message.error('加载失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ======= Convert CSV to ASC =======
  const handleConvertCSVtoASC = useCallback(async () => {
    if (!csvData) {
      message.warning('请先加载物理量 CSV 文件');
      return;
    }
    if (dbcMessages.length === 0) {
      message.warning('请先加载 DBC 文件');
      return;
    }

    try {
      const defaultName = `physical_csv_${Date.now()}.asc`;
      const filePath = await window.electronAPI.saveFile(defaultName, [
        { name: 'ASC Files', extensions: ['asc'] }
      ]);
      if (!filePath) return;

      setLoading(true);
      setConvertProgress(10);
      message.info('正在将物理量 CSV 转换为 ASC CAN 报文...');

      const result = await window.electronAPI.convertCSVtoASC(
        {
          dataRows: csvData.dataRows,
          msgIds: csvData.msgIds,
          signalCols: csvData.signalCols,
          msgSignalMap: csvData.msgSignalMap
        },
        dbcMessages,
        selectedCRC,
        { channel: 1, direction: 'Rx' }
      );

      setConvertProgress(70);

      if (result.success) {
        const exportResult = await window.electronAPI.exportASC(
          filePath,
          result.headerLines,
          result.messages
        );

        setConvertProgress(100);

        if (exportResult.success) {
          setLoadedMessages(result.messages);
          setHeaderLines(result.headerLines);
          message.success(
            `转换成功！${result.totalCount} 条 CAN 报文已生成并导出。` +
            (selectedCRC !== 'NONE' ? ` (使用 ${selectedCRC} 计算校验值)` : '')
          );
          setActiveTab('log');
        } else {
          message.error('导出失败: ' + exportResult.error);
        }
      } else {
        message.error('转换失败: ' + result.error);
      }
    } catch (error) {
      message.error('转换失败: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setConvertProgress(0), 1500);
    }
  }, [csvData, dbcMessages, selectedCRC]);

  // ======= Export parse error report as txt =======
  const handleExportParseErrors = useCallback(async () => {
    if (parseErrors.length === 0 && parseErrorCount === 0) return;
    try {
      const defaultName = `parse_errors_${Date.now()}.txt`;
      const filePath = await window.electronAPI.saveFile(defaultName, [
        { name: 'Text Files', extensions: ['txt'] }
      ]);
      if (!filePath) return;

      const lines = [];
      lines.push(`CAN Log Analyzer 解析错误报告`);
      lines.push(`生成时间: ${new Date().toLocaleString()}`);
      lines.push(`错误总数: ${parseErrorCount}`);
      lines.push(`显示列表: ${parseErrors.length} 条（列表截断至前 100 条）`);
      lines.push('='.repeat(60));
      for (const err of parseErrors) {
        if (err.lineNumber != null) {
          lines.push(`[行 ${err.lineNumber}] ${err.reason}`);
          if (err.line) lines.push(`  原文: ${err.line}`);
        } else {
          lines.push(`[偏移 0x${(err.offset || 0).toString(16).toUpperCase()}] ${err.reason}`);
        }
        lines.push('-' .repeat(60));
      }
      const result = await window.electronAPI.exportText(filePath, lines.join('\n'));
      if (result.success) {
        message.success('错误报告已导出');
      } else {
        message.error('导出失败: ' + result.error);
      }
    } catch (error) {
      message.error('导出失败: ' + error.message);
    }
  }, [parseErrors, parseErrorCount]);

  // ======= Clear All =======
  const handleClearAll = useCallback(() => {
    setAscFile(null);
    setBlfFile(null);
    setDbcMessages([]);
    setSelectedIds(new Set());
    setSelectedSignals([]);
    setLoadedMessages([]);
    setHeaderLines([]);
    setProgress(0);
    setCsvData(null);
    setCsvFile(null);
    setConvertProgress(0);
    setDbcRawContent('');
    setDbcFile(null);
    setParseErrors([]);
    setParseErrorCount(0);
    setParseErrorDrawerOpen(false);
    message.success('已清空所有数据，可以重新加载文件');
  }, []);

  // ======= R8: resizable splitter between the DBC panel and the results =======
  // Drag updates the width live; on release the value is persisted so the next
  // launch restores the same layout.
  const startPanelDrag = useCallback((e) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    const startX = e.clientX;
    const startW = panelWidthRef.current;
    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      const total = container?.offsetWidth || 1200;
      const next = Math.min(80, Math.max(20, startW + (delta / total) * 100));
      panelWidthRef.current = next;
      setPanelWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.electronAPI?.setSettings?.({ panelWidth: panelWidthRef.current });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // ======= R5: Project save / restore (.claproj) =======
  // A project bundles the loaded log + DBC paths, the signal selection, the
  // active tab and (future) filters. Saving writes a JSON file via the main
  // process; opening re-loads the sources then re-applies the selection.
  const applyProject = useCallback(async (project) => {
    if (!project) return;
    const dbc = (project.databases || [])[0];
    if (dbc && dbc.path) await loadDBCByPath(dbc.path);
    const log = (project.logs || [])[0];
    if (log && log.path) await loadLogByPath(log.path, log.type === 'blf' ? 'blf' : 'asc');
    // DBC load resets the selection — re-apply the saved state afterwards.
    if (project.selection) {
      if (Array.isArray(project.selection.msgIds) && project.selection.msgIds.length) {
        setSelectedIds(new Set(project.selection.msgIds));
      }
      if (Array.isArray(project.selection.signals) && project.selection.signals.length) {
        setSelectedSignals(project.selection.signals);
      }
    }
    if (project.activeTab) setActiveTab(project.activeTab);
    message.success('工程已恢复');
  }, [loadDBCByPath, loadLogByPath]);

  const openProjectFile = useCallback(async (filePath) => {
    const result = await window.electronAPI.openProject(filePath);
    if (result.success) {
      await applyProject(result.project);
    } else {
      message.error('打开工程失败: ' + result.error);
    }
  }, [applyProject]);

  const handleOpenProject = useCallback(async () => {
    const filePath = await window.electronAPI.openFile([
      { name: 'CAN Log Analyzer 工程', extensions: ['claproj'] },
      { name: 'All Files', extensions: ['*'] }
    ]);
    if (!filePath) return;
    await openProjectFile(filePath);
  }, [openProjectFile]);

  const handleSaveProject = useCallback(async () => {
    if (!(ascFile || blfFile || dbcFile)) {
      message.warning('当前没有可保存的内容，请先加载日志或 DBC');
      return;
    }
    const defaultName = `project_${Date.now()}.claproj`;
    const filePath = await window.electronAPI.saveFile(defaultName, [
      { name: 'CAN Log Analyzer 工程', extensions: ['claproj'] }
    ]);
    if (!filePath) return;

    const projectData = {
      format: 'claproj',
      version: 1,
      logs: [],
      databases: [],
      selection: {
        msgIds: Array.from(selectedIds),
        signals: selectedSignals
      },
      filters: {},
      activeTab,
      sampleStep: 1
    };
    if (ascFile) projectData.logs.push({ type: 'asc', path: ascFile.path });
    if (blfFile) projectData.logs.push({ type: 'blf', path: blfFile.path });
    if (dbcFile) projectData.databases.push({ path: dbcFile.path });

    const result = await window.electronAPI.saveProject(filePath, projectData);
    if (result.success) message.success('工程已保存');
    else message.error('保存失败: ' + result.error);
  }, [ascFile, blfFile, dbcFile, selectedIds, selectedSignals, activeTab]);

  // Wire application menu events (File / Help / Tool) sent by the Electron
  // main process. The main process sends { action, payload } and the renderer
  // maps each semantic action to the matching handler.
  useEffect(() => {
    if (!window.electronAPI?.onMenuEvent) return;
    const off = window.electronAPI.onMenuEvent(({ action, payload }) => {
      switch (action) {
        case 'help:open': setHelpOpen(true); break;
        case 'tool:clear':
          if (ascFile || blfFile || dbcMessages.length > 0 || loadedMessages.length > 0 || csvData) {
            handleClearAll();
          }
          break;
        case 'tool:convert-asc-blf': handleConvertASCtoBLF(); break;
        case 'tool:convert-csv-asc':
          if (csvData) setActiveTab('csv');
          else handleLoadCSV();
          break;
        case 'file:open-asc': handleLoadASC(); break;
        case 'file:open-blf': handleLoadBLF(); break;
        case 'file:load-dbc': handleLoadDBC(); break;
        case 'file:export-asc': handleExportASC(); break;
        case 'file:open-project': handleOpenProject(); break;
        case 'file:save-project': handleSaveProject(); break;
        case 'file:open-recent-log':
          if (payload) loadLogByPath(payload, String(payload).toLowerCase().endsWith('.blf') ? 'blf' : 'asc');
          break;
        case 'file:open-recent-dbc':
          if (payload) loadDBCByPath(payload);
          break;
        case 'file:open-recent-project':
          if (payload) openProjectFile(payload);
          break;
        default: break;
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, [ascFile, blfFile, dbcMessages.length, loadedMessages.length, csvData,
      handleClearAll, handleConvertASCtoBLF, handleLoadCSV, handleLoadASC,
      handleLoadBLF, handleLoadDBC, handleExportASC, handleOpenProject,
      handleSaveProject, loadLogByPath, loadDBCByPath, openProjectFile]);

  // R5: .claproj open requested by the OS — double-click on a project file,
  // or a second app instance launched while this one is already running.
  useEffect(() => {
    if (!window.electronAPI?.onProjectOpenRequest) return;
    const off = window.electronAPI.onProjectOpenRequest((filePath) => {
      if (filePath) openProjectFile(filePath);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [openProjectFile]);

  // R6: restore persisted preferences (last active tab).
  useEffect(() => {
    const getSettings = window.electronAPI?.getSettings;
    if (typeof getSettings === 'function') {
      getSettings().then(s => {
        if (s) {
          if (s.lastTab && ['signal', 'log', 'csv'].includes(s.lastTab)) {
            setActiveTab(s.lastTab);
          }
          if (typeof s.panelWidth === 'number' && s.panelWidth >= 20 && s.panelWidth <= 80) {
            panelWidthRef.current = s.panelWidth;
            setPanelWidth(s.panelWidth);
          }
        }
      }).catch(() => {});
    }
  }, []);

  // ======= Computed Stats =======
  const totalMessages = loadedMessages.length;
  const uniqueIds = new Set(loadedMessages.map(m => m.id)).size;
  const sourceFile = ascFile || blfFile;

  const tabItems = [
    {
      key: 'signal',
      label: (
        <span>
          <ThunderboltOutlined />
          信号解析
          {selectedSignals.length > 0 && (
            <span style={{
              marginLeft: 6, fontSize: 10, background: '#722ed1',
              color: '#fff', padding: '0 5px', borderRadius: 10
            }}>
              {selectedSignals.length}
            </span>
          )}
        </span>
      ),
      children: (
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <SignalParsePanel
            selectedSignals={selectedSignals}
            dbcMessages={dbcMessages}
            loadedMessages={loadedMessages}
            ascFile={ascFile}
            blfFile={blfFile}
            loading={loading}
          />
        </div>
      )
    },
    {
      key: 'log',
      label: (
        <span>
          <TableOutlined />
          CAN 报文日志
          {totalMessages > 0 && (
            <span style={{
              marginLeft: 6, fontSize: 10, background: '#1890ff',
              color: '#fff', padding: '0 5px', borderRadius: 10
            }}>
              {totalMessages > 9999 ? '9999+' : totalMessages}
            </span>
          )}
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <MessageTable messages={loadedMessages} loading={loading} dbcMessages={dbcMessages} />
          <div style={{ marginTop: 8, flexShrink: 0 }}>
            <ExportPanel
              onExport={handleExportASC}
              onExportCSV={handleExportLogCSV}
              onExportBLF={handleExportBLF}
              disabled={loadedMessages.length === 0}
              loading={loading}
              onExportProgress={window.electronAPI?.onExportProgress}
            />
          </div>
        </div>
      )
    },
    {
      key: 'csv',
      label: (
        <span>
          <SyncOutlined />
          物理量 CSV
          {csvData && (
            <span style={{
              marginLeft: 6, fontSize: 10, background: '#52c41a',
              color: '#fff', padding: '0 5px', borderRadius: 10
            }}>
              {csvData.totalRows}行
            </span>
          )}
        </span>
      ),
      children: (
        <div style={{ height: '100%', overflow: 'auto' }}>
          <CSVPanel
            csvData={csvData}
            dbcMessages={dbcMessages}
            onLoadCSV={handleLoadCSV}
            onConvertToASC={handleConvertCSVtoASC}
            loading={loading}
            crcAlgorithms={crcAlgorithms}
            selectedCRC={selectedCRC}
            onCRCChange={setSelectedCRC}
            convertProgress={convertProgress}
          />
        </div>
      )
    }
  ];

  return (
    <Layout style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ======= Header ======= */}
      <Header style={{
        background: '#ffffff', padding: '0 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0, height: 52, lineHeight: '52px',
        borderBottom: '1px solid #e8e8e8',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)'
      }}>
        {/* Logo: transparent-background brand mark (red ATEMall + gears on white).
            Slightly inset from the bar edge with objectFit:contain so the artwork
            keeps its aspect ratio. The original square silver logo.png is left
            untouched for the Electron app icon / favicon. */}
        <img
          src="header-logo.png"
          alt="CAN Log Analyzer"
          style={{ height: 44, padding: 4, objectFit: 'contain' }}
        />
        <Title level={4} style={{ color: '#1f1f1f', margin: 0, fontSize: 16, whiteSpace: 'nowrap' }}>
          CAN Log Analyzer <Tag color="gold" style={{ fontSize: 10, lineHeight: '16px' }}>Pro</Tag>
        </Title>

        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14,
          color: 'rgba(0,0,0,0.85)', fontSize: 12
        }}>
          <span>报文 <b style={{ color: '#1677ff' }}>{totalMessages}</b></span>
          <span>唯一ID <b style={{ color: '#1677ff' }}>{uniqueIds}</b></span>
          <span>DBC消息 <b style={{ color: '#1677ff' }}>{dbcMessages.length}</b></span>
          <span>已选信号 <b style={{ color: '#722ed1' }}>{selectedSignals.length}</b></span>
        </div>

        {/* Inline header buttons removed: "帮助" → moved to the application
            menu (Help > 使用手册); "清空" → moved to the Tool menu. Keeping
            the in-window chrome minimal so the brand mark gets the focus. */}
      </Header>

      {/* ======= Content ======= */}
      <Content style={{
        padding: 10, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', flex: 1, minHeight: 0
      }}>
        {/* Tool bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 10, flexShrink: 0, flexWrap: 'wrap'
        }}>
          <Button size="small" onClick={handleLoadASC} loading={loading}>
            <span>加载 ASC</span>
          </Button>
          <Button size="small" onClick={handleLoadBLF} loading={loading}>
            <span>加载 BLF</span>
          </Button>
          <Button
            size="small"
            onClick={handleConvertASCtoBLF}
            loading={loading}
            disabled={loadedMessages.length === 0}
            title="将当前已加载的 ASC 报文转换为 BLF 格式"
          >
            <span>ASC→BLF</span>
          </Button>
          <Button size="small" type="primary" ghost onClick={handleLoadDBC} loading={loading} data-testid="toolbar-load-dbc">
            <span>加载 DBC</span>
          </Button>

          {sourceFile && (
            <Tag color="blue" style={{ marginLeft: 4, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sourceFile.path.split(/[\\/]/).pop()}
            </Tag>
          )}
          {dbcMessages.length > 0 && (
            <Tag color="green">DBC: {dbcMessages.length} 条消息</Tag>
          )}

          {parseErrorCount > 0 && (
            <Tag
              color="warning"
              style={{ cursor: 'pointer', fontWeight: 600 }}
              onClick={() => setParseErrorDrawerOpen(true)}
              data-testid="parse-error-badge"
            >
              <WarningOutlined /> 解析完成：{parseErrorCount} 行错误
            </Tag>
          )}

          <Text type="secondary" style={{ marginLeft: 'auto', fontSize: 11 }}>
            {loadedMessages.length > 0
              ? `已加载 ${totalMessages} 条报文，勾选 DBC 信号后可解析`
              : '加载 ASC/BLF 日志与 DBC 文件后，在左侧勾选信号进行解析'}
          </Text>
        </div>

        {/* Search row - lives under the top toolbar (under "加载 DBC") so it
            doesn't squeeze the file-loader buttons. Filters the DBC message
            list inside the left panel. */}
        <div style={{ marginBottom: 10, flexShrink: 0 }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#999' }} />}
            placeholder="检索消息名 / ID / 信号名"
            value={dbcSearch}
            onChange={e => setDbcSearch(e.target.value)}
            allowClear
            size="small"
          />
        </div>

        {progress > 0 && progress < 100 && (
          <Progress percent={progress} status="active" size="small" style={{ marginBottom: 10, flexShrink: 0 }} />
        )}

        {/* Main area: left DBC full window + right results */}
        <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
          {/* Left: DBC structure full window (R8: width resizable + persisted) */}
          <div style={{
            width: `${panelWidth}%`, minWidth: 540, flexShrink: 0,
            border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden',
            background: '#fff', display: 'flex', flexDirection: 'column'
          }}>
            <DBCPanel
              messages={dbcMessages}
              selectedSignals={selectedSignals}
              dbcRawContent={dbcRawContent}
              onSignalToggle={handleSignalToggle}
              onSignalSelectAll={handleSignalSelectAll}
              onSignalClearAll={handleSignalClearAll}
              onMsgSignalSelectAll={handleMsgSignalSelectAll}
              onMsgSignalClearAll={handleMsgSignalClearAll}
              onLoadDBC={handleLoadDBC}
              onViewRaw={() => setRawModalOpen(true)}
              dbcLoaded={dbcMessages.length > 0}
              search={dbcSearch}
              onSearchChange={setDbcSearch}
            />
          </div>

          {/* R8: splitter — drag to resize the DBC panel */}
          <div
            onMouseDown={startPanelDrag}
            title="拖动调整面板宽度"
            data-testid="panel-splitter"
            style={{
              width: 8, flexShrink: 0, cursor: 'col-resize',
              alignSelf: 'stretch'
            }}
          />

          {/* Right: tabbed results */}
          <div style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
            border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden',
            background: '#fff'
          }}>
            <Tabs
              activeKey={activeTab}
              onChange={(key) => {
                setActiveTab(key);
                // R6: remember the active tab for the next launch.
                window.electronAPI?.setSettings?.({ lastTab: key });
              }}
              items={tabItems}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 8px' }}
              tabBarStyle={{ flexShrink: 0, marginBottom: 4 }}
            />
          </div>
        </div>
      </Content>

      {/* ======= DBC Raw Modal ======= */}
      <Modal
        open={rawModalOpen}
        onCancel={() => setRawModalOpen(false)}
        title={<Space><DatabaseOutlined />DBC 文件原文</Space>}
        footer={null}
        width="82%"
        style={{ top: 40 }}
      >
        <pre style={{
          maxHeight: '72vh', overflow: 'auto', fontSize: 12,
          fontFamily: 'Consolas, "Courier New", monospace',
          background: '#fafafa', padding: 12, borderRadius: 6,
          border: '1px solid #f0f0f0', lineHeight: 1.5
        }}>
          {dbcRawContent || '（无 DBC 内容）'}
        </pre>
      </Modal>

      {/* ======= Help Manual Modal ======= */}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ======= R4: Parse Error Report Drawer ======= */}
      <Drawer
        title={
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            解析错误报告
            <Tag color="warning">共 {parseErrorCount} 条</Tag>
          </Space>
        }
        open={parseErrorDrawerOpen}
        onClose={() => setParseErrorDrawerOpen(false)}
        width="62%"
      >
        {parseErrors.length === 0 ? (
          <Empty description="没有错误明细（错误列表截断至前 100 条）" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflow: 'auto', marginBottom: 16 }}>
              <List
                size="small"
                dataSource={parseErrors}
                renderItem={(err, idx) => (
                  <List.Item data-testid={`parse-error-item-${idx}`}>
                    <List.Item.Meta
                      title={
                        <Space size={8}>
                          <Tag color="red">
                            {err.lineNumber != null ? `行 ${err.lineNumber}` : `偏移 0x${(err.offset || 0).toString(16).toUpperCase()}`}
                          </Tag>
                          <Text strong style={{ fontSize: 12 }}>{err.reason}</Text>
                        </Space>
                      }
                      description={
                        err.line ? (
                          <code style={{
                            display: 'block', fontSize: 11, color: '#595959',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            background: '#fafafa', padding: '4px 8px', borderRadius: 4
                          }}>
                            {err.line}
                          </code>
                        ) : null
                      }
                    />
                  </List.Item>
                )}
              />
            </div>
            <div style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
              <Button
                type="primary"
                size="small"
                icon={<DownloadOutlined />}
                onClick={handleExportParseErrors}
                data-testid="export-parse-errors"
              >
                导出错误列表 (txt)
              </Button>
              <Button size="small" onClick={() => setParseErrorDrawerOpen(false)}>关闭</Button>
            </div>
          </div>
        )}
      </Drawer>
    </Layout>
  );
}

export default App;
