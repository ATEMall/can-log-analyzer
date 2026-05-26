import React, { useRef, useEffect, useState } from 'react';
import {
  Card, Button, Space, Table, Tag, Typography, Checkbox, Tooltip,
  Collapse, Badge
} from 'antd';
import {
  DatabaseOutlined, CheckSquareOutlined, BorderOutlined,
  FilterOutlined, RightOutlined
} from '@ant-design/icons';

const { Text } = Typography;
const { Panel } = Collapse;

function DBCPanel({ messages, selectedIds, onLoadDBC, onToggle, onSelectAll, onApplyFilter, loading, hasLogFile }) {
  const containerRef = useRef(null);
  const [tableHeight, setTableHeight] = useState(300);
  const [expandedRows, setExpandedRows] = useState([]);

  useEffect(() => {
    const calcHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const h = Math.max(rect.height - 115, 180);
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

  // Expandable row content: show all signals
  const expandedRowRender = (record) => {
    if (!record.signals || record.signals.length === 0) {
      return <Text type="secondary" style={{ fontSize: 11 }}>无信号定义</Text>;
    }

    const sigColumns = [
      {
        title: '信号名',
        dataIndex: 'name',
        key: 'name',
        width: 160,
        ellipsis: true,
        render: (name, sig) => (
          <Tooltip title={`${name}${sig.muxIndicator ? ' [' + sig.muxIndicator + ']' : ''}`}>
            <Text style={{ fontSize: 11 }}>
              {name}
              {sig.muxIndicator && (
                <Tag color="gold" style={{ fontSize: 9, marginLeft: 2 }}>{sig.muxIndicator}</Tag>
              )}
            </Text>
          </Tooltip>
        )
      },
      {
        title: '起始位',
        dataIndex: 'startBit',
        key: 'startBit',
        width: 60,
        align: 'center',
        render: v => <Text code style={{ fontSize: 10 }}>{v}</Text>
      },
      {
        title: '长度',
        dataIndex: 'length',
        key: 'length',
        width: 50,
        align: 'center',
        render: v => <Tag style={{ fontSize: 10 }}>{v}bit</Tag>
      },
      {
        title: '字节序',
        dataIndex: 'byteOrder',
        key: 'byteOrder',
        width: 65,
        align: 'center',
        render: v => (
          <Tag color={v === 'little' ? 'blue' : 'orange'} style={{ fontSize: 10 }}>
            {v === 'little' ? 'Intel' : 'Motorola'}
          </Tag>
        )
      },
      {
        title: '类型',
        dataIndex: 'signed',
        key: 'signed',
        width: 48,
        align: 'center',
        render: v => <Tag color={v ? 'red' : 'default'} style={{ fontSize: 10 }}>{v ? '有符号' : '无符号'}</Tag>
      },
      {
        title: 'Scale',
        dataIndex: 'scale',
        key: 'scale',
        width: 70,
        align: 'right',
        render: v => <Text style={{ fontSize: 10 }}>{v}</Text>
      },
      {
        title: 'Offset',
        dataIndex: 'offset',
        key: 'offset',
        width: 70,
        align: 'right',
        render: v => <Text style={{ fontSize: 10 }}>{v}</Text>
      },
      {
        title: '范围',
        key: 'range',
        width: 110,
        render: (_, sig) => (
          <Text style={{ fontSize: 10 }}>{`[${sig.min}, ${sig.max}]`}</Text>
        )
      },
      {
        title: '单位',
        dataIndex: 'unit',
        key: 'unit',
        width: 60,
        render: u => u ? <Tag style={{ fontSize: 10 }}>{u}</Tag> : '-'
      },
      {
        title: '接收方',
        dataIndex: 'receivers',
        key: 'receivers',
        render: (receivers) => (
          <Space size={2} wrap>
            {(receivers || []).map((r, i) => (
              <Tag key={i} color="geekblue" style={{ fontSize: 9 }}>{r}</Tag>
            ))}
          </Space>
        )
      }
    ];

    return (
      <Table
        dataSource={record.signals}
        columns={sigColumns}
        rowKey="name"
        size="small"
        pagination={false}
        scroll={{ x: 750 }}
        style={{ marginTop: 4 }}
        bordered
      />
    );
  };

  const columns = [
    {
      title: '选',
      key: 'select',
      width: 40,
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
      render: (dlc) => <Tag style={{ fontSize: 10 }}>{dlc}</Tag>
    },
    {
      title: '发送方',
      dataIndex: 'sender',
      key: 'sender',
      width: 75,
      ellipsis: true,
      render: (sender) => (
        <Tooltip title={sender}>
          <Tag color="blue" style={{ fontSize: 10 }}>{sender}</Tag>
        </Tooltip>
      )
    },
    {
      title: '信号',
      key: 'signalCount',
      width: 52,
      align: 'center',
      render: (_, record) => (
        <Badge
          count={record.signals.length}
          style={{ backgroundColor: record.signals.length > 0 ? '#52c41a' : '#d9d9d9', fontSize: 10 }}
          showZero
        />
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
            scroll={{ x: 400, y: tableHeight }}
            bordered
            tableLayout="fixed"
            style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
            expandable={{
              expandedRowRender,
              expandedRowKeys: expandedRows,
              onExpand: (expanded, record) => {
                setExpandedRows(expanded
                  ? [...expandedRows, record.id]
                  : expandedRows.filter(k => k !== record.id)
                );
              },
              rowExpandable: (record) => record.signals && record.signals.length > 0,
              expandIcon: ({ expanded, onExpand, record }) =>
                record.signals && record.signals.length > 0 ? (
                  <RightOutlined
                    style={{
                      fontSize: 10,
                      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                      cursor: 'pointer'
                    }}
                    onClick={e => onExpand(record, e)}
                  />
                ) : null
            }}
          />
        </>
      )}

      {messages.length === 0 && (
        <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
          <DatabaseOutlined style={{ fontSize: 28, marginBottom: 8 }} />
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>加载 DBC 文件以解析消息定义</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>支持完整信号解析（含多路复用、VAL_枚举）</Text>
        </div>
      )}
    </Card>
  );
}

export default DBCPanel;
