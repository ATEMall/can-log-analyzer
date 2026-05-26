import React, { useState, useCallback } from 'react';
import {
  Card, Button, Space, Table, Tag, Typography, Tooltip, Select,
  Divider, Alert, Statistic, Row, Col, Badge, Progress
} from 'antd';
import {
  FileTextOutlined, DatabaseOutlined, DownloadOutlined,
  InfoCircleOutlined, ThunderboltOutlined, SyncOutlined
} from '@ant-design/icons';

const { Text } = Typography;
const { Option } = Select;

function CSVPanel({
  csvData,
  dbcMessages,
  onLoadCSV,
  onConvertToASC,
  loading,
  crcAlgorithms,
  selectedCRC,
  onCRCChange,
  convertProgress
}) {
  const [tableHeight] = useState(240);

  // Build columns for signal overview table
  const columns = [
    {
      title: '消息ID',
      key: 'msgId',
      width: 80,
      render: (_, record) => (
        <Text code style={{ fontSize: 11 }}>
          {`0x${record.msgId.toString(16).toUpperCase().padStart(3, '0')}`}
          <br />
          <span style={{ color: '#999', fontSize: 10 }}>{`(${record.msgId})`}</span>
        </Text>
      )
    },
    {
      title: '信号名',
      dataIndex: 'signalName',
      key: 'signalName',
      ellipsis: true,
      render: (name, record) => (
        <Tooltip title={record.fullName}>
          <Text style={{ fontSize: 11 }}>{name}</Text>
        </Tooltip>
      )
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      width: 60,
      render: (unit) => unit ? <Tag style={{ fontSize: 10 }}>{unit}</Tag> : <Text type="secondary" style={{ fontSize: 10 }}>-</Text>
    },
    {
      title: 'DBC匹配',
      key: 'dbcMatch',
      width: 72,
      render: (_, record) => {
        const dbcMsg = dbcMessages.find(m => m.id === record.msgId);
        if (!dbcMsg) return <Tag color="red" style={{ fontSize: 10 }}>无DBC</Tag>;
        const sig = dbcMsg.signals.find(s =>
          s.name === record.signalName ||
          s.name.toLowerCase() === record.signalName.toLowerCase()
        );
        if (sig) return <Tag color="green" style={{ fontSize: 10 }}>已匹配</Tag>;
        return <Tag color="orange" style={{ fontSize: 10 }}>模糊匹配</Tag>;
      }
    }
  ];

  // Flatten signal columns for table display
  const tableData = csvData
    ? csvData.signalCols
        .filter(c => c && c.msgId !== null)
        .map((col, idx) => ({ ...col, key: idx }))
    : [];

  // Stats
  const matchedMsgCount = csvData
    ? csvData.msgIds.filter(id => dbcMessages.some(m => m.id === id)).length
    : 0;

  return (
    <Card
      title={<><FileTextOutlined /> 物理量 CSV</>}
      size="small"
      style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}
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
        <Button
          icon={<FileTextOutlined />}
          onClick={onLoadCSV}
          size="small"
          loading={loading}
        >
          加载 CSV
        </Button>
      }
    >
      {!csvData && (
        <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
          <FileTextOutlined style={{ fontSize: 28, marginBottom: 8 }} />
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            加载 TSMaster 物理量 CSV 文件
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            格式：#TITLES / #DATA，信号名_(消息ID)
          </Text>
        </div>
      )}

      {csvData && (
        <>
          {/* Stats Row */}
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={8}>
              <Statistic
                title="数据行"
                value={csvData.totalRows}
                valueStyle={{ fontSize: 16 }}
                prefix={<DatabaseOutlined />}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="信号数"
                value={tableData.length}
                valueStyle={{ fontSize: 16 }}
                prefix={<ThunderboltOutlined />}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="DBC匹配"
                value={matchedMsgCount}
                suffix={`/${csvData.msgIds.length}`}
                valueStyle={{ fontSize: 16, color: matchedMsgCount > 0 ? '#52c41a' : '#ff4d4f' }}
              />
            </Col>
          </Row>

          {/* Signal List Table */}
          <Table
            dataSource={tableData}
            columns={columns}
            rowKey="key"
            size="small"
            pagination={{ pageSize: 20, size: 'simple', showTotal: t => `${t} 个信号` }}
            scroll={{ y: tableHeight }}
            bordered
            style={{ marginBottom: 8 }}
          />

          {/* CRC Selection + Convert */}
          <Divider style={{ margin: '8px 0' }} />

          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <div>
              <Text strong style={{ fontSize: 12 }}>
                <SyncOutlined style={{ marginRight: 4 }} />
                CRC 算法选择
              </Text>
              <Tooltip title="选择 CRC 算法用于自动填充 CAN 报文中的 Checksum 信号。选择 NONE 则保留 CSV 中的原始校验值。">
                <InfoCircleOutlined style={{ marginLeft: 4, color: '#999', fontSize: 11 }} />
              </Tooltip>
            </div>

            <Select
              value={selectedCRC}
              onChange={onCRCChange}
              style={{ width: '100%' }}
              size="small"
              showSearch
              placeholder="选择 CRC 算法"
            >
              {crcAlgorithms.map(alg => (
                <Option key={alg.name} value={alg.name}>
                  <Tooltip title={alg.description} placement="right">
                    <span>
                      <Tag color={alg.name === 'NONE' ? 'default' : alg.name.startsWith('CRC8') ? 'blue' : alg.name.startsWith('CRC16') ? 'purple' : 'red'} style={{ fontSize: 10, marginRight: 4 }}>
                        {alg.name}
                      </Tag>
                      <span style={{ fontSize: 11, color: '#666' }}>{alg.description.substring(0, 30)}</span>
                    </span>
                  </Tooltip>
                </Option>
              ))}
            </Select>

            {dbcMessages.length === 0 && (
              <Alert
                message="请先加载 DBC 文件"
                description="需要 DBC 定义才能将物理量转换为 CAN 报文字节"
                type="warning"
                showIcon
                style={{ fontSize: 11 }}
              />
            )}

            {convertProgress > 0 && convertProgress < 100 && (
              <Progress percent={convertProgress} size="small" status="active" />
            )}

            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={onConvertToASC}
              disabled={!csvData || dbcMessages.length === 0}
              loading={loading}
              block
              size="small"
            >
              物理量 → ASC 转换
            </Button>
          </Space>
        </>
      )}
    </Card>
  );
}

export default CSVPanel;
