import React, { useState, useEffect } from 'react';
import { Card, Button, Statistic, Row, Col, Progress, Space } from 'antd';
import { DownloadOutlined, FileTextOutlined, FileExcelOutlined, FileZipOutlined } from '@ant-design/icons';

// R7: the message-log export card. Besides the existing ASC export it now offers
// CSV (time,id,name,dir,dlc,data columns) and BLF (binary vector format) export
// of the currently loaded log. All three stream through the main process.
function ExportPanel({ onExport, onExportCSV, onExportBLF, disabled, loading, exportProgress, onExportProgress }) {
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
        <Space size="small" wrap>
          <Button
            size="small"
            icon={<FileExcelOutlined />}
            onClick={onExportCSV}
            disabled={disabled}
            loading={loading}
          >
            导出为 CSV
          </Button>
          <Button
            size="small"
            icon={<FileZipOutlined />}
            onClick={onExportBLF}
            disabled={disabled}
            loading={loading}
          >
            导出为 BLF
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            onClick={onExport}
            disabled={disabled}
            loading={loading && progress > 0}
          >
            导出为 ASC
          </Button>
        </Space>
      }
    >
      <Row gutter={16}>
        <Col span={12}>
          <Statistic
            title="说明"
            value="根据已加载的报文"
            valueStyle={{ fontSize: 14 }}
          />
        </Col>
        <Col span={12}>
          <Statistic
            title="输出格式"
            value="ASC / CSV / BLF"
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
          ASC/CSV 可直接用文本工具或 Excel 打开；BLF 可用 CANalyzer/CANoe 打开
        </small>
      </div>
    </Card>
  );
}

export default ExportPanel;
