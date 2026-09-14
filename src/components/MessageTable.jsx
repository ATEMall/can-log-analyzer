import React, { useState, useRef, useEffect } from 'react';
import { Card, Table, Tag, Typography, Input, Space, Alert } from 'antd';
import { FileTextOutlined, SearchOutlined } from '@ant-design/icons';

const { Text } = Typography;

function MessageTable({
  messages,
  loading,
  dbcMessages = [],
  highlightIds = [],
  locateIndex = null,
  locateNonce = 0,
  timeWindow = null
}) {
  const [searchText, setSearchText] = useState('');
  const containerRef = useRef(null);
  const [tableHeight, setTableHeight] = useState(400);
  // R11: controlled pagination so a global-search hit can jump to its page.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const pendingLocateRef = useRef(null);
  const highlightSet = React.useMemo(
    () => new Set((highlightIds || []).map(Number)),
    [highlightIds]
  );

  // id -> message name map from DBC
  const msgNameMap = React.useMemo(() => {
    const m = {};
    for (const msg of dbcMessages) {
      m[msg.id] = msg.name;
    }
    return m;
  }, [dbcMessages]);

  // id -> DBC message (for extended-frame / format-mismatch marking)
  const dbcMsgMap = React.useMemo(() => {
    const m = {};
    for (const msg of dbcMessages) {
      m[msg.id] = msg;
    }
    return m;
  }, [dbcMessages]);

  // R3: whether a log frame is an extended (29-bit) CAN frame. Falls back to
  // the classic-CAN heuristic (id > 0x7FF) when the parser didn't record the
  // flag, mirroring the decoder in electron/signalDecode.js.
  const frameIsExtended = (record) => {
    if (record.isExtended !== undefined && record.isExtended !== null) {
      return !!record.isExtended;
    }
    return Number(record.id) > 0x7FF;
  };

  // Auto-calculate table height based on container
  useEffect(() => {
    const calcHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Card header + search bar + padding ~ 100px
        const h = Math.max(rect.height - 95, 200);
        setTableHeight(h);
      }
    };

    calcHeight();
    const timer = setTimeout(calcHeight, 50); // wait for layout settle

    window.addEventListener('resize', calcHeight);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', calcHeight);
    };
  }, [messages.length]);

  // Filter messages by the local quick filter and the shared R11 time window.
  // `sourceIdxs` keeps the absolute index of every surviving frame so a
  // global-search locate target maps onto the current page/filter state.
  const { filteredMessages, sourceIdxs } = React.useMemo(() => {
    const search = searchText.trim().toLowerCase();
    const out = [];
    const idxs = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (timeWindow) {
        const t = Number(msg.timestamp) || 0;
        if (t < timeWindow.start || t > timeWindow.end) continue;
      }
      if (search) {
        const msgName = (msgNameMap[msg.id] || '').toLowerCase();
        if (
          !msg.id.toString(16).toLowerCase().includes(search) &&
          !msg.id.toString().includes(search) &&
          !msgName.includes(search)
        ) continue;
      }
      idxs.push(i);
      out.push(msg);
    }
    return { filteredMessages: out, sourceIdxs: idxs };
  }, [messages, searchText, msgNameMap, timeWindow]);

  // R11: locate target -> page + scroll. locateNonce lets a repeated Enter on
  // the same hit re-scroll instead of being a no-op.
  const locatePos = React.useMemo(() => {
    if (locateIndex == null) return -1;
    const exact = sourceIdxs.indexOf(locateIndex);
    if (exact >= 0) return exact;
    // Target filtered out: fall back to the first frame at/after it.
    let lo = 0;
    let hi = sourceIdxs.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sourceIdxs[mid] >= locateIndex) { best = mid; hi = mid - 1; } else { lo = mid + 1; }
    }
    return best;
  }, [locateIndex, sourceIdxs]);

  React.useEffect(() => {
    if (locateIndex == null || locatePos < 0) return;
    pendingLocateRef.current = locatePos;
    setPage(Math.floor(locatePos / pageSize) + 1);
  }, [locateNonce, locateIndex, locatePos, pageSize]);

  React.useEffect(() => {
    const pos = pendingLocateRef.current;
    if (pos == null) return undefined;
    const timer = setTimeout(() => {
      const body = containerRef.current?.querySelector('.ant-table-tbody');
      const rows = body ? body.querySelectorAll('tr.ant-table-row') : [];
      const el = rows[pos % pageSize] || body?.querySelector('.search-hit-row');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center' });
      }
      pendingLocateRef.current = null;
    }, 60);
    return () => clearTimeout(timer);
  }, [page, pageSize, locateNonce]);

  // A different corpus or quick filter starts from the first page again.
  // Skipped on mount so it never overrides the locate effect above.
  const pageResetReadyRef = useRef(false);
  React.useEffect(() => {
    if (!pageResetReadyRef.current) {
      pageResetReadyRef.current = true;
      return;
    }
    setPage(1);
  }, [messages, searchText]);

  const columns = [
    {
      title: '序号',
      key: 'index',
      width: 60,
      render: (_, __, index) => index + 1
    },
    {
      title: '时间戳',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 140,
      render: (ts) => (
        <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {ts?.toFixed(6) || '0.000000'}
        </Text>
      )
    },
    {
      title: '通道',
      dataIndex: 'channel',
      key: 'channel',
      width: 52,
      align: 'center',
      render: (ch) => (
        <Tag color="purple" style={{ fontSize: 11 }}>
          {typeof ch === 'number' ? ch : (ch || 1)}
        </Tag>
      )
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 130,
      render: (id, record) => {
        const dbcMsg = dbcMsgMap[id];
        const frameExt = frameIsExtended(record);
        const dbcExt = !!dbcMsg?.isExtended;
        // R3: format mismatch (extended flag in log vs DBC model) -> grey "未匹配"
        const mismatch = !!dbcMsg && frameExt !== dbcExt;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Text code style={{ fontSize: 12, color: mismatch ? 'var(--text-faint)' : undefined }}>
              {id != null ? `0x${id.toString(16).toUpperCase().padStart(3, '0')}` : '0x000'}
            </Text>
            {(frameExt || dbcExt) && (
              <Tag color="blue" style={{ fontSize: 9, lineHeight: '14px', marginInlineEnd: 0 }}>Ext</Tag>
            )}
            {mismatch && (
              <Tag style={{ fontSize: 9, lineHeight: '14px', marginInlineEnd: 0, color: 'var(--text-faint)' }}>未匹配</Tag>
            )}
          </span>
        );
      }
    },
    {
      title: '消息名',
      key: 'msgName',
      width: 150,
      ellipsis: true,
      render: (_, record) => {
        const name = msgNameMap[record.id];
        return name
          ? <Tag color="cyan" style={{ fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Tag>
          : <Text type="secondary" style={{ fontSize: 11 }}>-</Text>;
      }
    },
    {
      title: '方向',
      dataIndex: 'direction',
      key: 'direction',
      width: 56,
      align: 'center',
      render: (dir) => (
        <Tag color={dir === 'Tx' ? 'green' : 'blue'} style={{ fontSize: 11 }}>
          {dir || 'Rx'}
        </Tag>
      )
    },
    {
      title: 'DLC',
      dataIndex: 'dlc',
      key: 'dlc',
      width: 48,
      align: 'center',
      render: (dlc) => (
        <Tag style={{ fontSize: 11 }}>{dlc || 0}</Tag>
      )
    },
    {
      title: '数据 (Hex)',
      dataIndex: 'data',
      key: 'data',
      ellipsis: true,
      render: (data) => (
        <Text
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            wordBreak: 'break-all'
          }}
          copyable={data && data.length > 0}
        >
          {data?.map(b => (b || 0).toString(16).toUpperCase().padStart(2, '0')).join(' ') || '-'}
        </Text>
      )
    }
  ];

  return (
    <Card
      ref={containerRef}
      title={<><FileTextOutlined /> 消息列表</>}
      size="small"
      style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{
        body: {
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flex: 1,
          minHeight: 0
        }
      }}
      extra={
        <Space>
          {highlightSet.size > 0 && (
            <Tag color="blue" style={{ fontSize: 11 }} data-testid="message-table-hit-ids">
              命中 {highlightSet.size} 个 ID
            </Tag>
          )}
          <Input
            placeholder="搜索 ID / 消息名..."
            prefix={<SearchOutlined />}
            style={{ width: 180 }}
            size="small"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            allowClear
          />
          {messages.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {filteredMessages.length} / {messages.length}
            </Text>
          )}
        </Space>
      }
    >
      <Table
        dataSource={filteredMessages}
        columns={columns}
        rowKey={(record, index) => `${record.timestamp}-${index}`}
        rowClassName={(record) => (highlightSet.has(Number(record.id)) ? 'search-hit-row' : '')}
        size="small"
        loading={loading}
        pagination={{
          current: Math.min(page, Math.max(1, Math.ceil(filteredMessages.length / pageSize))),
          pageSize,
          onChange: (p, ps) => {
            setPage(p);
            if (ps && ps !== pageSize) setPageSize(ps);
          },
          size: 'small',
          showSizeChanger: true,
          showQuickJumper: false,
          showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`,
          pageSizeOptions: ['20', '50', '100', '200', '500']
        }}
        scroll={{ y: tableHeight, x: 700 }}
        virtual
        bordered
        style={{ flex: 1, minHeight: 0 }}
      />

      {messages.length === 0 && !loading && (
        <Alert
          message="暂无消息"
          description="请加载 ASC 或 BLF 文件查看 CAN 消息"
          type="info"
          showIcon
          style={{ marginTop: 8 }}
        />
      )}
    </Card>
  );
}

export default MessageTable;
