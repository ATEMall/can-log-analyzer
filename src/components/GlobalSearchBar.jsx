import React from 'react';
import { Input, Select, Tag, Tooltip, Typography } from 'antd';
import { SearchOutlined, AimOutlined } from '@ant-design/icons';

const { Text } = Typography;

/**
 * R11 (v2.2) — 顶部单一全局搜索入口。
 *
 * - 统一检索：消息名 / 信号名 / CAN ID（十进制 + 0x 十六进制）/ DID
 * - Enter 定位首个命中帧；Ctrl+F 唤起、Esc 清除（快捷键在 App 中注册）
 * - 搜索范围可选：全部视图（报文帧 + DBC 结构）/ 当前视图（仅 DBC 结构）
 * - 命中计数（如 "12 hits"）以 Tag 呈现，无匹配时给出灰态提示。
 */
function GlobalSearchBar({
  value,
  onChange,
  onSubmit,
  result,
  scope,
  onScopeChange,
  inputRef,
  searching = false
}) {
  const query = (value || '').trim();
  const hasResult = !!result && result.kind !== 'empty';
  const matchCount = result?.matchCount ?? 0;
  const noLogFrames = hasResult && matchCount === 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Input
        ref={inputRef}
        data-testid="global-search-input"
        prefix={<SearchOutlined style={{ color: 'var(--text-hint)' }} />}
        placeholder="全局检索：消息名 / 信号名 / CAN ID(十进制或 0x) / DID，回车定位"
        value={value}
        onChange={e => onChange(e.target.value)}
        onPressEnter={onSubmit}
        allowClear
        size="small"
        style={{ flex: '1 1 320px', maxWidth: 520, minWidth: 220 }}
      />

      <Tooltip title="全部视图：报文帧 + DBC 结构；当前视图：仅 DBC 结构与已选信号">
        <Select
          data-testid="global-search-scope"
          size="small"
          value={scope}
          onChange={onScopeChange}
          style={{ width: 104 }}
          options={[
            { value: 'all', label: '全部视图' },
            { value: 'dbc', label: '当前视图' }
          ]}
        />
      </Tooltip>

      {query && (
        <Tag
          data-testid="global-search-count"
          color={noLogFrames ? 'default' : (hasResult ? 'blue' : 'default')}
          style={{ fontSize: 11, marginInlineEnd: 0, whiteSpace: 'nowrap' }}
        >
          {searching
            ? '检索中…'
            : (hasResult && matchCount > 0)
              ? `${matchCount} hits`
              : '无匹配'}
        </Tag>
      )}

      {query && hasResult && result.firstIndex != null && (
        <Tooltip title="回车定位到首个命中帧">
          <Tag
            icon={<AimOutlined />}
            color="magenta"
            style={{ fontSize: 11, marginInlineEnd: 0, whiteSpace: 'nowrap' }}
            data-testid="global-search-locate-hint"
          >
            回车定位
          </Tag>
        </Tooltip>
      )}

      <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
        Ctrl+F 唤起 · Esc 清除
      </Text>
    </div>
  );
}

export default GlobalSearchBar;
