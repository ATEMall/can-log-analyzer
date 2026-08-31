import React from 'react';
import { Table, Tag, Typography, Empty } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

const { Text } = Typography;

function SignalTable({ signalData, selectedSignals, dbcMessages }) {
  if (!signalData || signalData.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无解码数据，请先勾选信号并点击「开始解码」"
        style={{ padding: 40 }}
      />
    );
  }

  // Build columns: timestamp + one per selected signal
  const columns = [
    {
      title: '时间戳',
      dataIndex: 't',
      key: 't',
      width: 140,
      fixed: 'left',
      render: (t) => <Text code style={{ fontSize: 11 }}>{t.toFixed(6)}</Text>,
      sorter: (a, b) => a.t - b.t,
      defaultSortOrder: 'ascend'
    }
  ];

  // Add a column for each selected signal (deduplicated by key)
  const signalKeys = new Set(selectedSignals.map(s => s.key));
  const signalCols = [];

  for (const sig of selectedSignals) {
    if (!signalKeys.has(sig.key)) continue;
    signalKeys.delete(sig.key);

    // Find unit + float type from DBC
    let unit = '';
    let valueType = '';
    for (const msg of dbcMessages) {
      if (msg.id === sig.msgId) {
        const dbcSig = msg.signals.find(s => s.name === sig.signalName);
        if (dbcSig) {
          if (dbcSig.unit) unit = dbcSig.unit;
          if (dbcSig.valueType) valueType = dbcSig.valueType;
        }
        break;
      }
    }

    const colKey = sig.key;
    signalCols.push({
      title: (
        <span>
          <ThunderboltOutlined style={{ fontSize: 10, marginRight: 4, color: '#1890ff' }} />
          <Text style={{ fontSize: 11 }}>{sig.signalName}</Text>
          {unit && <Tag style={{ marginLeft: 4, fontSize: 9 }}>{unit}</Tag>}
        </span>
      ),
      dataIndex: colKey,
      key: colKey,
      width: 140,
      ellipsis: true,
      render: (val, record) => {
        if (val === null || val === undefined) return <Text type="secondary" style={{ fontSize: 10 }}>-</Text>;
        const lbl = record && record[colKey + '::label'];
        if (lbl !== undefined) {
          return <Tag color="purple" style={{ fontSize: 10 }}>{lbl}</Tag>;
        }
        if (typeof val === 'string') {
          return <Tag color="purple" style={{ fontSize: 10 }}>{val}</Tag>;
        }
        // R3: float signals (SIG_VALTYPE_) display with 6 significant digits
        if (valueType === 'float32' || valueType === 'float64') {
          return <Text style={{ fontSize: 11 }}>{val.toPrecision(6)}</Text>;
        }
        // Determine decimal places based on magnitude
        const absVal = Math.abs(val);
        let display;
        if (absVal === 0) {
          display = '0';
        } else if (absVal < 0.001) {
          display = val.toExponential(3);
        } else if (absVal < 1) {
          display = val.toFixed(4);
        } else if (absVal < 100) {
          display = val.toFixed(2);
        } else {
          display = val.toFixed(1);
        }
        return <Text style={{ fontSize: 11 }}>{display}</Text>;
      }
    });
  }

  // Remove timestamp from signal keys (it's column index 0)
  const allColumns = [...columns, ...signalCols];

  // Build data source from signalData
  const dataSource = signalData.map((row, idx) => {
    const record = { key: idx, t: row.t };
    for (const sig of selectedSignals) {
      if (row.signals && row.signals[sig.key] !== undefined) {
        record[sig.key] = row.signals[sig.key];
        const lbl = row.signals[sig.key + '::label'];
        if (lbl !== undefined) record[sig.key + '::label'] = lbl;
      }
    }
    return record;
  });

  return (
    <Table
      dataSource={dataSource}
      columns={allColumns}
      size="small"
      bordered
      scroll={{ x: Math.max(800, allColumns.length * 130), y: 400 }}
      pagination={{
        pageSize: 100,
        size: 'small',
        showSizeChanger: true,
        pageSizeOptions: ['50', '100', '200', '500'],
        showTotal: (total) => `共 ${total} 行`
      }}
      style={{ fontSize: 11 }}
    />
  );
}

export default SignalTable;
