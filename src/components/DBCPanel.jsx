import React, { useRef, useEffect, useState } from 'react';
import { Card, Button, Space, Table, Tag, Typography, Checkbox, Tooltip } from 'antd';
import { DatabaseOutlined, CheckSquareOutlined, BorderOutlined, FilterOutlined } from '@ant-design/icons';

const { Text } = Typography;

function DBCPanel({ messages, selectedIds, onLoadDBC, onToggle, onSelectAll, onApplyFilter, loading, hasLogFile }) {
  const containerRef = useRef(null);
  const [tableHeight, setTableHeight] = useState(300);

  useEffect(() => {
    const calcHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Button bar + card header + padding ~ 115px
        const h = Math.max(rect.height - 110, 180);
        setTableHeight(h);
      }
    };

    calcHeight();
    const timer = setTimeout(calcHeight, 50);
    window.addEventListener('resize', calcHeight);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', calcHeight);
    };
  }, [messages.length]);

  const columns = [
    {
      title: '选',
      key: 'select',
      width: 44,
      fixed: 'left',
      render: (_, record) => (
        <Checkbox
          checked={selectedIds.has(record.id)}
          onChange={() => onToggle(record.id)}
        />
      )
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 68,
      render: (id) => (
        <Text code style={{ fontSize: 11 }}>
          {`0x${id.toString(16).toUpperCase().padStart(3, '0')}`}
        </Text>
      )
    },
    {
      title: '消息名称',
      dataIndex: 'name',
      key: 'name',
      width: 110,
      ellipsis: true,
      render: (name) => (
        <Tooltip title={name}>
          <Text strong style={{ fontSize: 12 }}>{name}</Text>
        </Tooltip>
      )
    },
    {
      title: 'DLC',
      dataIndex: 'dlc',
      key: 'dlc',
      width: 42,
      align: 'center',
      render: (dlc) => <Tag style={{ fontSize: 10 }} >{dlc}</Tag>
    },
    {
      title: '发送方',
      dataIndex: 'sender',
      key: 'sender',
      width: 70,
      ellipsis: true,
      render: (sender) => (
        <Tooltip title={sender}>
          <Tag color="blue" style={{ fontSize: 10 }}>{sender}</Tag>
        </Tooltip>
      )
    },
    {
      title: '信号数',
      key: 'signalCount',
      width: 56,
      align: 'center',
      render: (_, record) => (
        <Tooltip
          title={
            record.signals.length > 0
              ? record.signals.map(s => `${s.name}[${s.startBit}:${s.startBit + s.length - 1}]`).join('\n')
              : '无信号'
          }
        >
          <Tag color={record.signals.length > 0 ? 'green' : 'default'} style={{ fontSize: 10 }}>
            {record.signals.length}
          </Tag>
        </Tooltip>
      )
    }
  ];

  return (
    <Card
      ref={containerRef}
      title={<><DatabaseOutlined /> DBC 文件</>}
      size="small"
      style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}
      styles={{
        body: {
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flex: 1,
          minHeight: 0
        }
      }}
      extra={
        <Button
          icon={<DatabaseOutlined />}
          onClick={onLoadDBC}
          size="small"
        >
          加载 DBC
        </Button>
      }
    >
      {messages.length > 0 && (
        <>
          <Space size={4} style={{ marginBottom: 6, flexWrap: 'wrap' }}>
            <Button size="small" icon={<CheckSquareOutlined />} onClick={() => onSelectAll(true)}>
              全选
            </Button>
            <Button size="small" icon={<BorderOutlined />} onClick={() => onSelectAll(false)}>
              取消全选
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<FilterOutlined />}
              onClick={onApplyFilter}
              disabled={!hasLogFile}
              loading={loading}
            >
              应用过滤
            </Button>
            <Text type="secondary" style={{ fontSize: 11 }}>
              共 {messages.length} 条 | 已选 {selectedIds.size}
            </Text>
          </Space>

          <Table
            dataSource={messages}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 50, size: 'simple', showTotal: (t) => `${t}` }}
            scroll={{ x: 450, y: tableHeight }}
            bordered
            tableLayout="fixed"
            style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
          />
        </>
      )}

      {messages.length === 0 && (
        <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
          <DatabaseOutlined style={{ fontSize: 28, marginBottom: 8 }} />
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>加载 DBC 文件以解析消息定义</Text>
        </div>
      )}
    </Card>
  );
}

export default DBCPanel;
