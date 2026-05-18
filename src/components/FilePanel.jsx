import React from 'react';
import { Card, Button, Space, Tag, Typography, Popconfirm } from 'antd';
import { FolderOpenOutlined, FileTextOutlined, ClearOutlined } from '@ant-design/icons';

const { Text } = Typography;

function FilePanel({ ascFile, blfFile, onLoadASC, onLoadBLF, onClear, loading }) {
  return (
    <Card
      title="加载日志文件"
      size="small"
      bodyStyle={{ padding: '8px 12px' }}
      extra={
        <Space>
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            onClick={onLoadASC}
            loading={loading}
            size="small"
          >
            ASC
          </Button>
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            onClick={onLoadBLF}
            loading={loading}
            size="small"
          >
            BLF
          </Button>
          {(ascFile || blfFile) && onClear && (
            <Popconfirm
              title="确认清空"
              description="清空所有已加载数据？"
              onConfirm={onClear}
              okText="清空"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button icon={<ClearOutlined />} size="small">
                清空
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    >
      <Space size={24}>
        <div>
          <Text strong>ASC:</Text>
          {' '}
          {ascFile ? (
            <Tag color="green" icon={<FileTextOutlined />} style={{ maxWidth: 220 }}>
              {ascFile.path.split('/').pop()}
            </Tag>
          ) : (
            <Text type="secondary">未加载</Text>
          )}
          {ascFile?.stats && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
              ({ascFile.stats.formattedSize})
            </Text>
          )}
        </div>

        <div>
          <Text strong>BLF:</Text>
          {' '}
          {blfFile ? (
            <Tag color="blue" icon={<FileTextOutlined />} style={{ maxWidth: 220 }}>
              {blfFile.path.split('/').pop()}
            </Tag>
          ) : (
            <Text type="secondary">未加载</Text>
          )}
          {blfFile?.stats && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
              ({blfFile.stats.formattedSize})
            </Text>
          )}
        </div>
      </Space>
    </Card>
  );
}

export default FilePanel;
