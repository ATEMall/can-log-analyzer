import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout, Typography, message, Statistic, Row, Col, Progress,
  Button, Popconfirm, Space, Tabs
} from 'antd';
import {
  FileTextOutlined, DatabaseOutlined, FilterOutlined,
  DownloadOutlined, InboxOutlined, ClearOutlined,
  TableOutlined, SyncOutlined
} from '@ant-design/icons';
import FilePanel from './components/FilePanel';
import DBCPanel from './components/DBCPanel';
import MessageTable from './components/MessageTable';
import ExportPanel from './components/ExportPanel';
import CSVPanel from './components/CSVPanel';

const { Header, Content } = Layout;
const { Title } = Typography;

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

  // Physical CSV state
  const [csvData, setCsvData] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [crcAlgorithms, setCrcAlgorithms] = useState([]);
  const [selectedCRC, setSelectedCRC] = useState('NONE');
  const [convertProgress, setConvertProgress] = useState(0);

  // Active tab
  const [activeTab, setActiveTab] = useState('log');

  // Load CRC algorithms on mount
  useEffect(() => {
    window.electronAPI?.getCRCAlgorithms().then(algs => {
      setCrcAlgorithms(algs || []);
    }).catch(() => {});
  }, []);

  // ======= ASC Load =======
  const handleLoadASC = useCallback(async () => {
    try {
      const filePath = await window.electronAPI.openFile([
        { name: 'ASC Files', extensions: ['asc'] }
      ]);
      if (!filePath) return;

      setLoading(true);
      setProgress(10);
      message.info('正在加载 ASC 文件...');

      const result = await window.electronAPI.loadASC(filePath, []);
      setProgress(50);

      if (result.success) {
        const stats = await window.electronAPI.getStats(filePath);
        setAscFile({ path: filePath, stats });
        setBlfFile(null);
        setLoadedMessages(result.messages);
        setHeaderLines(result.headerLines);
        message.success(`加载成功，共 ${result.totalCount} 条消息`);
        setActiveTab('log');
      } else {
        message.error('加载失败: ' + result.error);
      }

      setProgress(100);
    } catch (error) {
      message.error('加载失败: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 500);
    }
  }, []);

  // ======= BLF Load =======
  const handleLoadBLF = useCallback(async () => {
    try {
      const filePath = await window.electronAPI.openFile([
        { name: 'BLF Files', extensions: ['blf'] }
      ]);
      if (!filePath) return;

      setLoading(true);
      setProgress(10);
      message.info('正在加载 BLF 文件...');

      const result = await window.electronAPI.loadBLF(filePath, []);
      setProgress(60);

      if (result.success) {
        const stats = await window.electronAPI.getStats(filePath);
        setBlfFile({ path: filePath, stats });
        setAscFile(null);
        setLoadedMessages(result.messages);
        setHeaderLines(result.headerLines);
        message.success(`加载成功，共 ${result.totalCount} 条消息`);
        setActiveTab('log');
      } else {
        message.error('加载失败: ' + result.error);
      }

      setProgress(100);
    } catch (error) {
      message.error('加载失败: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 500);
    }
  }, []);

  // ======= DBC Load =======
  const handleLoadDBC = useCallback(async () => {
    try {
      const filePath = await window.electronAPI.openFile([
        { name: 'DBC Files', extensions: ['dbc'] }
      ]);
      if (!filePath) return;

      message.info('正在解析 DBC 文件...');
      const result = await window.electronAPI.loadDBC(filePath);

      if (result.success) {
        setDbcMessages(result.messages);
        setSelectedIds(new Set(result.messages.map(m => m.id)));
        // Count total signals
        const totalSignals = result.messages.reduce((sum, m) => sum + m.signals.length, 0);
        message.success(`加载成功，共 ${result.messages.length} 条消息，${totalSignals} 个信号`);
      } else {
        message.error('加载失败: ' + result.error);
      }
    } catch (error) {
      message.error('加载失败: ' + error.message);
    }
  }, []);

  // ======= Toggle / Select All =======
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

  // ======= Apply Filter =======
  const handleApplyFilter = useCallback(async () => {
    if (loadedMessages.length === 0) {
      message.warning('请先加载 ASC 或 BLF 文件');
      return;
    }

    const sourceFile = ascFile || blfFile;
    setLoading(true);
    message.info('正在根据选择的消息 ID 过滤...');

    try {
      let result;
      if (ascFile) {
        result = await window.electronAPI.loadASC(sourceFile.path, Array.from(selectedIds));
      } else {
        result = await window.electronAPI.loadBLF(sourceFile.path, Array.from(selectedIds));
      }

      if (result.success) {
        setLoadedMessages(result.messages);
        setHeaderLines(result.headerLines);
        message.success(`过滤完成，保留 ${result.messages.length} 条消息`);
      }
    } catch (error) {
      message.error('过滤失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [loadedMessages, selectedIds, ascFile, blfFile]);

  // ======= Export ASC (from loaded messages) =======
  const handleExportASC = useCallback(async () => {
    if (loadedMessages.length === 0) {
      message.warning('没有可导出的消息');
      return;
    }

    try {
      const defaultName = `filtered_${Date.now()}.asc`;
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

      // Convert: pass csvData (rows+signal mapping), dbcMessages, crcAlgorithm
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
        // Export to file
        const exportResult = await window.electronAPI.exportASC(
          filePath,
          result.headerLines,
          result.messages
        );

        setConvertProgress(100);

        if (exportResult.success) {
          // Also load the converted messages into the viewer
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

  // ======= Clear All =======
  const handleClearAll = useCallback(() => {
    setAscFile(null);
    setBlfFile(null);
    setDbcMessages([]);
    setSelectedIds(new Set());
    setLoadedMessages([]);
    setHeaderLines([]);
    setProgress(0);
    setCsvData(null);
    setCsvFile(null);
    setConvertProgress(0);
    message.success('已清空所有数据，可以重新加载文件');
  }, []);

  // ======= Computed Stats =======
  const totalMessages = loadedMessages.length;
  const uniqueIds = new Set(loadedMessages.map(m => m.id)).size;
  const hasAnyData = !!(ascFile || blfFile || dbcMessages.length > 0 || loadedMessages.length > 0 || csvData);

  const tabItems = [
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
          <MessageTable messages={loadedMessages} loading={loading} />
          <div style={{ marginTop: 12, flexShrink: 0 }}>
            <ExportPanel
              onExport={handleExportASC}
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
    <Layout style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header style={{
        background: '#001529', padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <Title level={4} style={{ color: 'white', margin: 0 }}>
          <InboxOutlined style={{ marginRight: 8 }} />
          CAN Log Analyzer v1.1
        </Title>

        {hasAnyData && (
          <Popconfirm
            title="确认清空"
            description="将清空所有已加载的文件和数据，确定继续？"
            onConfirm={handleClearAll}
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<ClearOutlined />} size="small">
              清空全部
            </Button>
          </Popconfirm>
        )}
      </Header>

      <Content style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flex: 1,
        minHeight: 0
      }}>
        {/* Top Bar */}
        <div style={{ marginBottom: 12, flexShrink: 0 }}>
          <Row gutter={[12, 12]} align="middle">
            <Col flex="auto">
              <FilePanel
                ascFile={ascFile}
                blfFile={blfFile}
                onLoadASC={handleLoadASC}
                onLoadBLF={handleLoadBLF}
                onClear={handleClearAll}
                loading={loading}
              />
            </Col>

            <Col>
              <Space size="large">
                <Statistic title="报文数" value={totalMessages} prefix={<FileTextOutlined />} />
                <Statistic title="唯一ID" value={uniqueIds} prefix={<FilterOutlined />} />
                <Statistic title="DBC定义" value={dbcMessages.length} prefix={<DatabaseOutlined />} />
                {csvData && (
                  <Statistic
                    title="CSV行数"
                    value={csvData.totalRows}
                    prefix={<SyncOutlined />}
                    valueStyle={{ color: '#52c41a' }}
                  />
                )}
              </Space>
            </Col>
          </Row>

          {progress > 0 && progress < 100 && (
            <Progress percent={progress} status="active" size="small" style={{ marginTop: 8 }} />
          )}
        </div>

        {/* Main Content */}
        <div style={{
          display: 'flex',
          gap: 16,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden'
        }}>
          {/* Left: DBC Panel */}
          <div style={{ width: 420, minWidth: 340, flexShrink: 0, overflow: 'auto' }}>
            <DBCPanel
              messages={dbcMessages}
              selectedIds={selectedIds}
              onLoadDBC={handleLoadDBC}
              onToggle={handleToggleMessage}
              onSelectAll={handleSelectAll}
              onApplyFilter={handleApplyFilter}
              loading={loading}
              hasLogFile={!!(ascFile || blfFile)}
            />
          </div>

          {/* Right: Tabbed content */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={tabItems}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              tabBarStyle={{ flexShrink: 0, marginBottom: 8 }}
            />
          </div>
        </div>
      </Content>
    </Layout>
  );
}

export default App;
