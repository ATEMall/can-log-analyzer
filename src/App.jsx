import React, { useState, useCallback } from 'react';
import { Layout, Typography, message, Statistic, Row, Col, Progress, Button, Popconfirm, Space } from 'antd';
import {
  FileTextOutlined, DatabaseOutlined, FilterOutlined,
  DownloadOutlined, InboxOutlined, ClearOutlined
} from '@ant-design/icons';
import FilePanel from './components/FilePanel';
import DBCPanel from './components/DBCPanel';
import MessageTable from './components/MessageTable';
import ExportPanel from './components/ExportPanel';

const { Header, Content } = Layout;
const { Title } = Typography;

function App() {
  // State
  const [ascFile, setAscFile] = useState(null);
  const [blfFile, setBlfFile] = useState(null);
  const [dbcMessages, setDbcMessages] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadedMessages, setLoadedMessages] = useState([]);
  const [headerLines, setHeaderLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Load ASC file
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
        setLoadedMessages(result.messages);
        setHeaderLines(result.headerLines);
        message.success(`加载成功，共 ${result.totalCount} 条消息`);
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

  // Load BLF file
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
        setLoadedMessages(result.messages);
        setHeaderLines(result.headerLines);
        message.success(`加载成功，共 ${result.totalCount} 条消息`);
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

  // Load DBC file
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
        message.success(`加载成功，共 ${result.messages.length} 条消息定义`);
      } else {
        message.error('加载失败: ' + result.error);
      }
    } catch (error) {
      message.error('加载失败: ' + error.message);
    }
  }, []);

  // Toggle message selection
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

  // Select all / Deselect all
  const handleSelectAll = useCallback((select) => {
    if (select) {
      setSelectedIds(new Set(dbcMessages.map(m => m.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [dbcMessages]);

  // Filter messages based on selection
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

  // Export to ASC
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

  // Clear all loaded data
  const handleClearAll = useCallback(() => {
    setAscFile(null);
    setBlfFile(null);
    setDbcMessages([]);
    setSelectedIds(new Set());
    setLoadedMessages([]);
    setHeaderLines([]);
    setProgress(0);
    message.success('已清空所有数据，可以重新加载文件');
  }, []);

  // Stats
  const totalMessages = loadedMessages.length;
  const uniqueIds = new Set(loadedMessages.map(m => m.id)).size;
  const hasAnyData = !!(ascFile || blfFile || dbcMessages.length > 0 || loadedMessages.length > 0);

  return (
    <Layout style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header style={{
        background: '#001529', padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <Title level={4} style={{ color: 'white', margin: 0 }}>
          <InboxOutlined style={{ marginRight: 8 }} />
          CAN Log Analyzer
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
        {/* Top Bar: File loading + Stats */}
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
                <Statistic title="消息数" value={totalMessages} prefix={<FileTextOutlined />} />
                <Statistic title="唯一ID" value={uniqueIds} prefix={<FilterOutlined />} />
                <Statistic title="DBC定义" value={dbcMessages.length} prefix={<DatabaseOutlined />} />
              </Space>
            </Col>
          </Row>
          
          {progress > 0 && progress < 100 && (
            <Progress percent={progress} status="active" size="small" style={{ marginTop: 8 }} />
          )}
        </div>

        {/* Main content: DBC Panel | Message Table side by side */}
        <div style={{
          display: 'flex',
          gap: 16,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden'
        }}>
          {/* Left: DBC Panel - fixed width */}
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
          
          {/* Right: Message Table - fills remaining space */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
        </div>
      </Content>
    </Layout>
  );
}

export default App;
