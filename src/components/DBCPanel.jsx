import React, { useMemo, useState } from 'react';
import {
  Checkbox, Button, Table, Tooltip, Badge, Tag, Empty, Divider, Modal, Tabs, Space
} from 'antd';
import {
  DatabaseOutlined, FileTextOutlined, ClearOutlined,
  CheckSquareOutlined, DownOutlined, RightOutlined, FullscreenOutlined
} from '@ant-design/icons';
import SignalLayoutView from './SignalLayoutView';

/**
 * DBC Panel - full window view of DBC structure:
 * left: searchable message/signal list, right: signal bit-layout + details table.
 */
function DBCPanel({
  messages = [],
  selectedSignals = [],
  dbcRawContent = '',
  onSignalToggle,
  onSignalSelectAll,
  onSignalClearAll,
  onMsgSignalSelectAll,
  onMsgSignalClearAll,
  onLoadDBC,
  onViewRaw,
  dbcLoaded = false,
  // search state lives in the parent (App) now so the search box can sit in
  // the top toolbar instead of inside this panel
  search: externalSearch,
  onSearchChange,
  // R10: expansion state may be lifted to the parent (App) for persistence.
  // When `expandedMsgs` is provided the panel is controlled and reports every
  // change via `onExpandedMsgsChange`; standalone renders (tests, demos) keep
  // the internal state instead.
  expandedMsgs: controlledExpandedMsgs,
  onExpandedMsgsChange
}) {
  const [internalSearch, setInternalSearch] = useState('');
  const search = externalSearch !== undefined ? externalSearch : internalSearch;
  const setSearch = onSearchChange || setInternalSearch;
  const [internalExpandedMsgs, setInternalExpandedMsgs] = useState({});
  const expandedMsgs = controlledExpandedMsgs !== undefined
    ? controlledExpandedMsgs
    : internalExpandedMsgs;
  const [selectedMsgId, setSelectedMsgId] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Toggle one message row's expansion. Controlled mode reports the new map
  // up so the parent can persist it; uncontrolled mode updates internal state.
  const toggleExpand = (id) => {
    const next = { ...expandedMsgs, [id]: !expandedMsgs[id] };
    if (controlledExpandedMsgs !== undefined) {
      onExpandedMsgsChange?.(next);
    } else {
      setInternalExpandedMsgs(next);
    }
  };

  const selectedSignalKeys = useMemo(() => new Set(selectedSignals.map(s => `${s.msgId}::${s.signalName}`)), [selectedSignals]);

  // msg.id can be a number (from DBC parse); normalize to a searchable string
  const msgIdString = (msg) => {
    const idStr = String(msg.id);
    return idStr.startsWith('0x') ? idStr.toLowerCase() : `0x${Number(msg.id).toString(16)}`;
  };

  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages
      .map(msg => {
        const idLower = msgIdString(msg);
        const sigMatches = (msg.signals || []).filter(s =>
          s.name.toLowerCase().includes(q) ||
          (msg.name || '').toLowerCase().includes(q) ||
          idLower.includes(q)
        );
        const msgMatches =
          msg.name.toLowerCase().includes(q) ||
          idLower.includes(q) ||
          String(msg.id).includes(q);
        if (msgMatches) return { ...msg, matchAll: true };
        if (sigMatches.length > 0) return { ...msg, signals: sigMatches };
        return null;
      })
      .filter(Boolean);
  }, [messages, search]);

  const totalSignalCount = useMemo(
    () => messages.reduce((acc, m) => acc + (m.signals?.length || 0), 0),
    [messages]
  );

  const handleMsgClick = (id) => {
    setSelectedMsgId(id);
    toggleExpand(id);
  };

  const selectedMsg = messages.find(m => m.id === selectedMsgId) || null;

  const renderSignalRow = (msg, sig) => {
    const key = `${msg.id}::${sig.name}`;
    const checked = selectedSignalKeys.has(key);
    const selected = selectedSignalKeys.has(key);
    return (
      <div
        key={key}
        onClick={(e) => { e.stopPropagation(); onSignalToggle(msg.id, sig.name); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 4px',
          cursor: 'pointer', borderRadius: 4, background: selected ? 'var(--bg-selected)' : 'transparent',
          fontSize: 12
        }}
      >
        <Checkbox checked={checked} />
        <span style={{ fontWeight: 600 }}>{sig.name}</span>
        {sig.muxIndicator === 'M' && (
          <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>M</Tag>
        )}
        {sig.muxIndicator && sig.muxIndicator !== 'M' && (
          <Tag style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0, color: 'var(--text-secondary)' }}>
            {sig.muxIndicator}
          </Tag>
        )}
        <Tag style={{ marginLeft: 'auto', fontSize: 10, lineHeight: '16px' }}>
          {sig.startBit}|{sig.length}@{sig.byteOrder === 'little' ? '1' : '0'}
        </Tag>
      </div>
    );
  };

  const renderMsgRow = (msg, index) => {
    const isExpanded = !!expandedMsgs[msg.id];
    const isSelected = selectedMsgId === msg.id;
    const sigs = msg.signals || [];
    const selectedCount = sigs.filter(s => selectedSignalKeys.has(`${msg.id}::${s.name}`)).length;
    const allSelected = sigs.length > 0 && selectedCount === sigs.length;
    const someSelected = selectedCount > 0 && !allSelected;

    // Tx/Rx definitions: Tx = sender node from the BO_ line; Rx = the union of
    // receivers declared on each SG_ signal (excluding the "Vector__XXX" placeholder).
    const txNode = msg.sender || '-';
    const rxNodes = [...new Set(
      (sigs || []).flatMap(s => Array.isArray(s.receivers) ? s.receivers : [])
    )].filter(r => r && r !== 'Vector__XXX');
    const rxText = rxNodes.length > 0 ? rxNodes.join(', ') : '-';

    const handleMsgCheck = (e) => {
      e.stopPropagation();
      if (allSelected) onMsgSignalClearAll(msg.id);
      else onMsgSignalSelectAll(msg.id);
    };

    return (
      <div key={msg.id}>
        <div
          onClick={() => handleMsgClick(msg.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
            cursor: 'pointer', borderRadius: 4,
            background: isSelected ? 'var(--bg-selected)' : 'transparent',
            border: isSelected ? '1px solid var(--border-selected)' : '1px solid transparent'
          }}
        >
          {isExpanded ? <DownOutlined style={{ fontSize: 10, color: 'var(--text-hint)' }} /> : <RightOutlined style={{ fontSize: 10, color: 'var(--text-hint)' }} />}
          <span onClick={handleMsgCheck} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              style={{ marginRight: 2 }}
            />
          </span>
          <code style={{ fontWeight: 700, color: 'var(--text-accent)', fontSize: 12 }}>{msgIdString(msg)}</code>
          {msg.isExtended && (
            <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>Ext</Tag>
          )}
          <span style={{ fontSize: 12, fontWeight: 600 }}>{msg.name}</span>
          {typeof msg.cycleTime === 'number' && msg.cycleTime > 0 && (
            <Tag style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0, color: 'var(--text-quiet)' }}>
              {msg.cycleTime}ms
            </Tag>
          )}
          <Badge
            count={sigs.length}
            style={{ marginLeft: 'auto', backgroundColor: 'var(--brand)' }}
            size="small"
          />
        </div>
        <div
          onClick={() => handleMsgClick(msg.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 8px 4px 52px', cursor: 'pointer',
            fontSize: 11, color: 'var(--text-regular)'
          }}
        >
          <Tooltip title={`Tx: ${txNode}`}>
            <Tag color="green" style={{ fontSize: 10, marginInlineEnd: 0 }}>Tx: {txNode}</Tag>
          </Tooltip>
          <Tooltip title={`Rx: ${rxText}`}>
            <Tag color="blue" style={{ fontSize: 10, marginInlineEnd: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>Rx: {rxText}</Tag>
          </Tooltip>
        </div>
        {isExpanded && (
          <div
            data-testid="dbc-msg-signals"
            style={{
              paddingLeft: 28, borderLeft: '2px solid var(--border-selected)', marginLeft: 14,
              // Cap the inline signal list so very wide messages (e.g. CAN FD with
              // 40+ signals) don't push the right-side layout off-screen.
              maxHeight: 240, overflowY: 'auto',
              // A tiny inner padding so the scrollbar never sits flush against text.
              paddingRight: 2
            }}
          >
            {sigs.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-hint)', padding: '2px 8px' }}>无信号定义</div>
            )}
            {sigs.map(sig => renderSignalRow(msg, sig))}
          </div>
        )}
      </div>
    );
  };

  const detailColumns = [
    { title: '信号', dataIndex: 'name', key: 'name', width: 130, fixed: 'left', render: (t, r) => <span style={{ fontWeight: 600 }}>{t}</span> },
    { title: '起始位', dataIndex: 'startBit', key: 'startBit', width: 70 },
    { title: '长度(bit)', dataIndex: 'length', key: 'length', width: 85 },
    { title: '字节序', dataIndex: 'byteOrder', key: 'byteOrder', width: 80, render: (t) => t === 'little' ? <Tag color="blue">Intel</Tag> : <Tag color="purple">Motorola</Tag> },
    { title: '类型', dataIndex: 'isSigned', key: 'isSigned', width: 60, render: (t) => t ? '有符号' : '无符号' },
    { title: '缩放', dataIndex: 'factor', key: 'factor', width: 70, align: 'right' },
    { title: '偏移', dataIndex: 'offset', key: 'offset', width: 70, align: 'right' },
    { title: '范围', dataIndex: 'range', key: 'range', width: 110, render: (_, r) => `${r.min} ~ ${r.max}` },
    { title: '单位', dataIndex: 'unit', key: 'unit', width: 60 },
    { title: '接收者', dataIndex: 'receivers', key: 'receivers', ellipsis: true, render: (t) => Array.isArray(t) ? t.join(', ') : (t || '-') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0
      }}>
        <DatabaseOutlined style={{ color: 'var(--brand)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>DBC 结构与信号布局</span>
        <Badge count={messages.length} size="small" style={{ backgroundColor: 'var(--ok-green)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>
          {messages.length} 条消息 / {totalSignalCount} 个信号
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Tooltip title={selectedSignals.length === 0 ? '当前没有已选信号' : '清空所有已选信号'}>
            <Button
              size="small"
              danger
              icon={<ClearOutlined />}
              onClick={onSignalClearAll}
              disabled={selectedSignals.length === 0}
            >清空</Button>
          </Tooltip>
          <Tooltip title="查看 DBC 原文">
            <Button size="small" icon={<FileTextOutlined />} onClick={onViewRaw}
              disabled={!dbcRawContent}>DBC 原文</Button>
          </Tooltip>
          <Button size="small" type="primary" icon={<DatabaseOutlined />}
            onClick={onLoadDBC}>{dbcLoaded ? '重新加载' : '加载 DBC'}</Button>
        </div>
      </div>

      {/* Body: left list + right layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Message list */}
        <div style={{
          width: '38%', minWidth: 220, borderRight: '1px solid var(--border-subtle)',
          overflow: 'auto', padding: '4px 6px'
        }}>
          <div style={{
            display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center', padding: '0 2px'
          }}>
            <Button size="small" icon={<CheckSquareOutlined />} onClick={onSignalSelectAll}
              disabled={!messages.length || selectedSignals.length === totalSignalCount}>全选信号</Button>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-hint)' }}>
              已选 {selectedSignals.length}/{totalSignalCount}
            </span>
          </div>
          {filteredMessages.length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配的消息或信号" />
          )}
          {filteredMessages.map(renderMsgRow)}
        </div>

        {/* Right: layout + details */}
        <div style={{ flex: 1, overflow: 'auto', padding: 8, minWidth: 0 }}>
          {selectedMsg ? (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap'
              }}>
                <code style={{ fontWeight: 700, color: 'var(--text-accent)' }}>{selectedMsg.id}</code>
                <span style={{ fontWeight: 700 }}>{selectedMsg.name}</span>
                <Tag color="blue">DLC {selectedMsg.dlc || 8} 字节</Tag>
                <Tag>{selectedMsg.transmitter || ''}</Tag>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-hint)' }}>
                  点击信号或图例可切换解码
                </span>
              </div>
              <div style={{ background: 'var(--bg-well)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 8 }}>
                <SignalLayoutView
                  message={selectedMsg}
                  selectedSignalNames={selectedSignals.filter(s => s.msgId === selectedMsg.id).map(s => s.signalName)}
                  onSignalToggle={(sigName) => onSignalToggle(selectedMsg.id, sigName)}
                  compact
                />
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                margin: '12px 0 8px'
              }}>
                <Divider style={{ margin: 0 }}>信号详情</Divider>
                <Button
                  type="link"
                  size="small"
                  icon={<FullscreenOutlined />}
                  onClick={() => setDetailModalOpen(true)}
                  data-testid="open-detail-modal"
                >
                  弹窗查看全部信号与详情
                </Button>
              </div>
              <Table
                size="small"
                columns={detailColumns}
                dataSource={selectedMsg.signals || []}
                rowKey="name"
                pagination={false}
                scroll={{ x: 900, y: 8 * 29 }}
                rowClassName={(r) => selectedSignalKeys.has(`${selectedMsg.id}::${r.name}`) ? 'sig-row-selected' : ''}
                onRow={(r) => ({
                  onClick: () => onSignalToggle(selectedMsg.id, r.name),
                  style: { cursor: 'pointer' }
                })}
              />
              {/* Modal: full signal list + details in one popup, so the full
                  set can be browsed without the inline 8-row scroll cap. */}
              <Modal
                open={detailModalOpen}
                onCancel={() => setDetailModalOpen(false)}
                footer={null}
                width="80%"
                destroyOnHidden
                title={
                  <Space>
                    <span>信号列表与详情</span>
                    <span style={{ color: 'var(--text-hint)', fontWeight: 400 }}>
                      {selectedMsg.name} · {selectedMsg.signals?.length || 0} 信号
                    </span>
                  </Space>
                }
              >
                <Tabs
                  defaultActiveKey="details"
                  items={[
                    {
                      key: 'details',
                      label: '信号详情',
                      children: (
                        <Table
                          size="small"
                          columns={detailColumns}
                          dataSource={selectedMsg.signals || []}
                          rowKey="name"
                          pagination={false}
                          scroll={{ x: 900, y: 480 }}
                          rowClassName={(r) => selectedSignalKeys.has(`${selectedMsg.id}::${r.name}`) ? 'sig-row-selected' : ''}
                          onRow={(r) => ({
                            onClick: () => onSignalToggle(selectedMsg.id, r.name),
                            style: { cursor: 'pointer' }
                          })}
                        />
                      )
                    },
                    {
                      key: 'list',
                      label: '信号列表',
                      children: (
                        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                            <Button
                              size="small"
                              onClick={() => onMsgSignalSelectAll(selectedMsg.id)}
                            >全选本消息</Button>
                            <Button
                              size="small"
                              onClick={() => onMsgSignalClearAll(selectedMsg.id)}
                            >清空本消息</Button>
                          </div>
                          <div data-testid="detail-modal-signal-list">
                            {(selectedMsg.signals || []).map(sig => renderSignalRow(selectedMsg, sig))}
                          </div>
                        </div>
                      )
                    }
                  ]}
                />
              </Modal>
            </>
          ) : (
            <Empty description="在左侧点击一条消息，查看其信号位布局图与详情" />
          )}
        </div>
      </div>
    </div>
  );
}

export default DBCPanel;
