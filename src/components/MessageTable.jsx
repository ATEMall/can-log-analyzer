import React, { useState, useRef, useEffect } from 'react';
import { Card, Table, Tag, Typography, Input, Space, Alert } from 'antd';
import { FileTextOutlined, SearchOutlined } from '@ant-design/icons';

const { Text } = Typography;

function MessageTable({ messages, loading }) {
  const [searchText, setSearchText] = useState('');
  const containerRef = useRef(null);
  const [tableHeight, setTableHeight] = useState(400);

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

  // Filter messages based on search
  const filteredMessages = messages.filter(msg => {
    if (!searchText) return true;
    const search = searchText.toLowerCase();
    return (
      msg.id.toString(16).toLowerCase().includes(search) ||
      msg.id.toString().includes(search)
    );
  });

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
      width: 90,
      render: (id) => (
        <Text code style={{ fontSize: 12 }}>
          {id != null ? `0x${id.toString(16).toUpperCase().padStart(3, '0')}` : '0x000'}
        </Text>
      )
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
          <Input
            placeholder="搜索 ID..."
            prefix={<SearchOutlined />}
            style={{ width: 140 }}
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
        size="small"
        loading={loading}
        pagination={{
          pageSize: 100,
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
