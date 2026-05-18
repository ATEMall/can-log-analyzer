import React, { useState, useEffect } from 'react';
import { Card, Button, Statistic, Row, Col, Progress } from 'antd';
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';

function ExportPanel({ onExport, disabled, loading, exportProgress, onExportProgress }) {
  const [progress, setProgress] = useState(0);
  const [progressInfo, setProgressInfo] = useState(null);

  useEffect(() => {
    if (onExportProgress) {
      const unsubscribe = onExportProgress((data) => {
        setProgress(data.progress);
        setProgressInfo(data);
      });
      return unsubscribe;
    }
  }, [onExportProgress]);

  // Reset progress when export finishes
  useEffect(() => {
    if (!loading && progress === 100) {
      const timer = setTimeout(() => {
        setProgress(0);
        setProgressInfo(null);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [loading, progress]);

  return (
    <Card
      title="导出"
      size="small"
      extra={
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={onExport}
          disabled={disabled}
          loading={loading && progress > 0}
        >
          导出为 ASC
        </Button>
      }
    >
      <Row gutter={16}>
        <Col span={12}>
          <Statistic
            title="说明"
            value="根据选中的 DBC 消息 ID"
            valueStyle={{ fontSize: 14 }}
          />
        </Col>
        <Col span={12}>
          <Statistic
            title="输出格式"
            value="ASC (ASCII)"
            valueStyle={{ fontSize: 14 }}
          />
        </Col>
      </Row>

      {progress > 0 && (
        <div style={{ marginTop: 12 }}>
          <Progress
            percent={progress}
            status={progress === 100 ? 'success' : 'active'}
            size="small"
            format={(p) => progressInfo ? `${progressInfo.processed}/${progressInfo.total} 帧` : `${p}%`}
          />
        </div>
      )}

      <div style={{ marginTop: 12, padding: 8, background: '#f0f0f0', borderRadius: 4 }}>
        <FileTextOutlined style={{ marginRight: 8 }} />
        <small>
          ASC 格式文件可直接用 CANalyzer/CANoe 打开，或使用文本编辑器查看
        </small>
      </div>
    </Card>
  );
}

export default ExportPanel;
