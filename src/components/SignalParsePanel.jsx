import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Card, Button, Space, Typography, Tag, Tabs, message, Progress,
  Statistic, Row, Col, Tooltip, Input, Empty
} from 'antd';
import {
  ThunderboltOutlined, DownloadOutlined, StopOutlined,
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
  // R2: chunked decode progress + incremental chunk accumulation
  const [decodeProgress, setDecodeProgress] = useState(null);
  const chunkBufRef = useRef({ rows: null, decoded: 0, received: 0 });

  // R2: subscribe to chunked decode events (progress + incremental results).
  // The chunk-result handler accumulates rows so the table/chart can append
  // progressively instead of waiting for the whole corpus.
  useEffect(() => {
    const offProgress = window.electronAPI?.onDecodeProgress?.(data => setDecodeProgress(data));
    const offChunk = window.electronAPI?.onDecodeChunkResult?.(data => {
      const buf = chunkBufRef.current;
      if (!buf.rows) buf.rows = [];
      if (data.rows && data.rows.length) buf.rows.push(...data.rows);
      buf.decoded += data.decodedCount || 0;
      buf.received++;
    });
    return () => {
      if (typeof offProgress === 'function') offProgress();
      if (typeof offChunk === 'function') offChunk();
    };
  }, []);

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

  // Handle decode button click. R2: prefers the chunked protocol so 1M-frame
  // logs stream through the main process without freezing the UI; falls back
  // to the legacy one-shot call when decodeChunked is unavailable.
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
    setDecodeProgress({ chunk: 0, totalChunks: 1, percent: 0 });
    chunkBufRef.current = { rows: null, decoded: 0, received: 0 };
    message.info('正在解码信号...');

    const selList = selectedSignals.map(s => ({ msgId: s.msgId, signalName: s.signalName }));

    try {
      const useChunked = typeof window.electronAPI?.decodeChunked === 'function';
      let result;

      if (useChunked) {
        const filePath = (ascFile || blfFile)?.path;
        const payload = { selectedSignals: selList, dbcMessages, chunkSize: 500000 };
        if (filePath) payload.filePath = filePath;
        else payload.messages = loadedMessages;
        result = await window.electronAPI.decodeChunked(payload);

        if (result.success) {
          // Prefer the incrementally accumulated rows (chunk-result events);
          // fall back to the full payload if events were not all delivered.
          const buf = chunkBufRef.current;
          const signalData = (buf.rows && buf.received > 0) ? buf.rows : result.signalData;
          setSignalData(signalData);
          setDecodeStats(result.stats);
          message.success(
            result.cancelled
              ? `解码已取消：已完成 ${buf.decoded} 帧`
              : `解码完成：${result.stats.totalFrames} 帧 → ${result.stats.decodedFrames} 帧含信号数据`
          );
        } else {
          message.error('解码失败: ' + result.error);
        }
      } else {
        result = await window.electronAPI.decodeSignalFrames(loadedMessages, selList, dbcMessages);
        if (result.success) {
          setSignalData(result.signalData);
          setDecodeStats(result.stats);
          message.success(
            `解码完成：${result.stats.totalFrames} 帧 → ${result.stats.decodedFrames} 帧含信号数据`
          );
        } else {
          message.error('解码失败: ' + result.error);
        }
      }
    } catch (error) {
      message.error('解码失败: ' + error.message);
    } finally {
      setDecoding(false);
      setDecodeProgress(null);
    }
  }, [selectedSignals, loadedMessages, dbcMessages, ascFile, blfFile]);

  // R2: cancel an in-flight chunked decode (main process checks at block
  // boundaries, so cancellation lands within one chunk).
  const handleCancelDecode = useCallback(async () => {
    try {
      await window.electronAPI?.decodeCancel?.();
    } catch (_) {}
    message.info('正在取消解码...');
  }, []);

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

              {/* R2: chunked decode progress + cancel */}
              {decoding && (
                <>
                  <div style={{ width: 140, display: 'inline-block', verticalAlign: 'middle' }}>
                    <Progress
                      percent={decodeProgress?.percent ?? 0}
                      size="small"
                      status={decodeProgress?.percent >= 100 ? 'success' : 'active'}
                    />
                  </div>
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    onClick={handleCancelDecode}
                  >
                    取消
                  </Button>
                </>
              )}

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
