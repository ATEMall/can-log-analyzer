import React, { useState, useCallback, useMemo } from 'react';
import {
  Card, Button, Space, Typography, Tag, Tabs, message,
  Statistic, Row, Col, Tooltip, Input, Empty
} from 'antd';
import {
  ThunderboltOutlined, DownloadOutlined,
  TableOutlined, LineChartOutlined, BarChartOutlined, SearchOutlined
} from '@ant-design/icons';
import SignalTable from './SignalTable';
import SignalChart from './SignalChart';

const { Text, Title } = Typography;

function SignalParsePanel({
  selectedSignals,
  dbcMessages,
  loadedMessages,
  ascFile,
  blfFile,
  loading,
  onDecodeSignals,
  onExportSignalCSV,
  onSaveSignalCSV
}) {
  const [activeView, setActiveView] = useState('table');
  const [signalData, setSignalData] = useState(null);
  const [decodeStats, setDecodeStats] = useState(null);
  const [decoding, setDecoding] = useState(false);
  const [searchText, setSearchText] = useState('');

  // Filter selected signals by search keyword (signal name / msg name / msg id)
  // NOTE: sig.msgId can be a number (from DBC parse) - never call string methods on it directly
  const filteredSignals = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return selectedSignals;
    return selectedSignals.filter(sig => {
      const msg = dbcMessages.find(m => m.id === sig.msgId);
      const msgName = msg ? msg.name : '';
      const idStr = String(sig.msgId).toLowerCase();
      const numId = Number(sig.msgId);
      const msgIdHex = Number.isFinite(numId) ? `0x${numId.toString(16)}` : idStr;
      return (
        sig.signalName.toLowerCase().includes(q) ||
        msgName.toLowerCase().includes(q) ||
        msgIdHex.includes(q) ||
        idStr.includes(q)
      );
    });
  }, [selectedSignals, dbcMessages, searchText]);

  // Handle decode button click
  const handleDecode = useCallback(async () => {
    if (selectedSignals.length === 0) {
      message.warning('请先在 DBC 面板中勾选需要解析的信号');
      return;
    }

    if (!loadedMessages || loadedMessages.length === 0) {
      message.warning('请先加载 ASC 或 BLF 日志文件');
      return;
    }

    setDecoding(true);
    message.info('正在解码信号...');

    try {
      const result = await window.electronAPI.decodeSignalFrames(
        loadedMessages,
        selectedSignals.map(s => ({ msgId: s.msgId, signalName: s.signalName })),
        dbcMessages
      );

      if (result.success) {
        setSignalData(result.signalData);
        setDecodeStats(result.stats);
        message.success(
          `解码完成：${result.stats.totalFrames} 帧 → ${result.stats.decodedFrames} 帧含信号数据`
        );
      } else {
        message.error('解码失败: ' + result.error);
      }
    } catch (error) {
      message.error('解码失败: ' + error.message);
    } finally {
      setDecoding(false);
    }
  }, [selectedSignals, loadedMessages, dbcMessages]);

  // Handle CSV export
  const handleExportCSV = useCallback(async () => {
    if (!signalData || signalData.length === 0) {
      message.warning('没有可导出的数据，请先解码');
      return;
    }

    try {
      const defaultName = `signal_decode_${Date.now()}.csv`;
      const filePath = await window.electronAPI.saveFile(defaultName, [
        { name: 'CSV Files', extensions: ['csv'] }
      ]);
      if (!filePath) return;

      message.info('正在导出 CSV...');
      const result = await window.electronAPI.exportSignalCSV(
        filePath,
        signalData,
        selectedSignals.map(s => ({ msgId: s.msgId, signalName: s.signalName }))
      );

      if (result.success) {
        message.success(`导出成功！${signalData.length} 行数据已保存`);
      } else {
        message.error('导出失败: ' + result.error);
      }
    } catch (error) {
      message.error('导出失败: ' + error.message);
    }
  }, [signalData, selectedSignals]);

  // Count how many selected signals match each message
  const signalMsgCount = {};
  for (const sig of selectedSignals) {
    const msg = dbcMessages.find(m => m.id === sig.msgId);
    const msgName = msg ? msg.name : `0x${sig.msgId.toString(16).toUpperCase()}`;
    signalMsgCount[msgName] = (signalMsgCount[msgName] || 0) + 1;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 10 }}>
      {/* Top control bar */}
      <Card size="small" styles={{ body: { padding: '8px 12px' } }}>
        <Row gutter={[8, 8]} align="middle">
          {/* Left: action buttons (wrap when narrow) */}
          <Col flex="auto" style={{ minWidth: 0 }}>
            <Space size="small" wrap>
              <Text strong style={{ fontSize: 13 }}>
                <ThunderboltOutlined style={{ marginRight: 4 }} />
                信号解析
              </Text>

              {selectedSignals.length > 0 && (
                <Tooltip
                  title={Object.entries(signalMsgCount).map(([k, v]) => `${k}: ${v}个信号`).join(', ')}
                >
                  <Tag color="blue" style={{ fontSize: 11 }}>
                    已选 {selectedSignals.length} 个信号
                  </Tag>
                </Tooltip>
              )}

              <Button
                type="primary"
                size="small"
                icon={<ThunderboltOutlined />}
                onClick={handleDecode}
                loading={decoding}
                disabled={selectedSignals.length === 0 || loadedMessages.length === 0}
              >
                开始解码
              </Button>

              {signalData && signalData.length > 0 && (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={handleExportCSV}
                >
                  导出 CSV
                </Button>
              )}
            </Space>
          </Col>

          {/* Right: fixed search box - never overlaps the buttons.
              Width is intentionally short so the red clear (allowClear) icon
              inside the input always stays visible next to the match tag. */}
          <Col flex="none" style={{ minWidth: 0 }}>
            <Space size={4} wrap>
              <Input
                size="small"
                prefix={<SearchOutlined style={{ color: '#999' }} />}
                placeholder="检索信号 / 消息名 / ID"
                allowClear
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={{ width: 150, minWidth: 120 }}
              />
              {searchText.trim() && (
                <Tag color="purple" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  匹配 {filteredSignals.length} / {selectedSignals.length}
                </Tag>
              )}
            </Space>
          </Col>
        </Row>

        {/* Second row: decode stats (only when available) */}
        {decodeStats && (
          <Row gutter={16} style={{ marginTop: 8 }}>
            <Col>
              <Space size="large">
                <Statistic
                  title="总帧数"
                  value={decodeStats.totalFrames}
                  valueStyle={{ fontSize: 14 }}
                />
                <Statistic
                  title="含信号帧"
                  value={decodeStats.decodedFrames}
                  valueStyle={{ fontSize: 14, color: '#52c41a' }}
                />
                {decodeStats.encodedSignals > 0 && (
                  <Statistic
                    title="枚举信号"
                    value={decodeStats.encodedSignals}
                    valueStyle={{ fontSize: 14, color: '#722ed1' }}
                  />
                )}
              </Space>
            </Col>
          </Row>
        )}
      </Card>

      {/* Main content: table or chart */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {!signalData ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#999'
          }}>
            <div style={{ textAlign: 'center' }}>
              <ThunderboltOutlined style={{ fontSize: 48, marginBottom: 16, color: '#d9d9d9' }} />
              <br />
              <Text type="secondary" style={{ fontSize: 13 }}>
                勾选 DBC 信号 → 点击「开始解码」
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 11 }}>
                支持 Intel/Motorola 字节序、有符号/无符号、多路复用(mux)
              </Text>
              {loadedMessages.length === 0 && (
                <>
                  <br />
                  <Text type="danger" style={{ fontSize: 11 }}>
                    请先加载 ASC 或 BLF 日志文件
                  </Text>
                </>
              )}
            </div>
          </div>
        ) : (
          <Card
            size="small"
            className="chart-card"
            styles={{ body: { padding: 4 } }}
            style={{ height: '100%' }}
            tabList={[
              { key: 'table', tab: <span><TableOutlined /> 数据表格</span> },
              { key: 'chart', tab: <span><LineChartOutlined /> 曲线图</span> }
            ]}
            activeTabKey={activeView}
            onTabChange={setActiveView}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {filteredSignals.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={`没有与 "${searchText}" 匹配的已选信号`}
                  style={{ padding: 40 }}
                />
              ) : (
                <>
                  {activeView === 'table' && (
                    <SignalTable
                      signalData={signalData}
                      selectedSignals={filteredSignals}
                      dbcMessages={dbcMessages}
                    />
                  )}
                  {activeView === 'chart' && (
                    <SignalChart
                      signalData={signalData}
                      selectedSignals={filteredSignals}
                      dbcMessages={dbcMessages}
                    />
                  )}
                </>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default SignalParsePanel;
