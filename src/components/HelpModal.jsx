import React from 'react';
import { Modal, Typography, Divider, Tag, Space } from 'antd';
import {
  BookOutlined, ThunderboltOutlined, TableOutlined, SyncOutlined,
  DatabaseOutlined, SwapOutlined, FileTextOutlined, QuestionCircleOutlined
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

// 简单代码/文件路径样式
const codeStyle = {
  background: '#f5f5f5', border: '1px solid #eee', borderRadius: 4,
  padding: '1px 5px', fontSize: 12, fontFamily: 'Consolas, "Courier New", monospace'
};

function StepList({ items }) {
  return (
    <ol style={{ margin: '4px 0 8px 0', paddingLeft: 20, lineHeight: 1.9 }}>
      {items.map((it, i) => <li key={i} style={{ fontSize: 13 }}>{it}</li>)}
    </ol>
  );
}

function FeatureList({ items }) {
  return (
    <ul style={{ margin: '4px 0 8px 0', paddingLeft: 20, lineHeight: 1.9 }}>
      {items.map((it, i) => <li key={i} style={{ fontSize: 13 }}>{it}</li>)}
    </ul>
  );
}

const HelpModal = ({ open, onClose }) => (
  <Modal
    open={open}
    onCancel={onClose}
    onOk={onClose}
    okText="我知道了"
    cancelButtonProps={{ style: { display: 'none' } }}
    width="78%"
    style={{ top: 24 }}
    title={<Space><BookOutlined />CAN Log Analyzer Pro 使用手册</Space>}
  >
    <div style={{ maxHeight: '74vh', overflow: 'auto', paddingRight: 8 }}>
      <Typography>
        {/* ============ 1. 简介 ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>一、软件简介</Title>
        <Paragraph style={{ fontSize: 13 }}>
          CAN Log Analyzer Pro 是一款本地运行的 CAN/CAN FD 日志分析桌面工具（Electron + React），
          支持解析 <Text code>ASC</Text> / <Text code>BLF</Text> 两种主流总线日志格式，并结合{' '}
          <Text code>DBC</Text> 数据库文件对报文进行<b>信号级解码</b>，最终以「数值表格 + 曲线图 + 位布局图」三种视图呈现，
          帮助工程师快速定位信号异常、进行数据回放与二次加工。
        </Paragraph>
        <Paragraph style={{ fontSize: 13 }}>
          支持格式一览：
        </Paragraph>
        <Space wrap size={[4, 4]} style={{ marginBottom: 8 }}>
          <Tag color="blue">ASC 日志</Tag>
          <Tag color="blue">BLF 日志</Tag>
          <Tag color="green">DBC 数据库</Tag>
          <Tag color="purple">物理量 CSV</Tag>
          <Tag color="orange">导出 ASC / BLF</Tag>
          <Tag color="geekblue">CAN 2.0</Tag>
          <Tag color="geekblue">CAN FD 64 字节</Tag>
        </Space>

        <Divider style={{ margin: '12px 0' }} />

        {/* ============ 2. 快速上手 ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>二、快速上手（四步完成首次分析）</Title>
        <StepList items={[
          <span><b>加载日志</b>：点击工具栏「加载 ASC」或「加载 BLF」，选择日志文件（可同时支持普通 CAN 与 CAN FD 帧）。</span>,
          <span><b>加载 DBC</b>：点击工具栏「加载 DBC」，选择对应的 DBC 数据库文件（支持多帧 CAN FD 64 字节定义，信号可占满 B0–B63）。</span>,
          <span><b>勾选信号</b>：在左侧「DBC 结构与信号布局」面板展开消息，勾选需要分析的信号（支持消息级全选/单选）。</span>,
          <span><b>查看结果</b>：右侧「信号解析」页签自动生成<b>数值表格</b>与<b>曲线图</b>，底部「布局视图」可查看信号在报文中的位分布。</span>,
        ]} />

        <Divider style={{ margin: '12px 0' }} />

        {/* ============ 3. 界面总览 ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>三、界面总览</Title>
        <Paragraph style={{ fontSize: 13 }}>
          <b>顶部标题栏</b>：实时显示「报文总数 / 唯一 ID 数 / DBC 消息数 / 已选信号数」，右侧「清空」按钮可一键重置所有已加载数据。
        </Paragraph>
        <Paragraph style={{ fontSize: 13 }}>
          <b>工具栏</b>：依次为
          <Text code>加载 ASC</Text>、<Text code>加载 BLF</Text>、<Text code>ASC→BLF</Text>（将当前报文转换为 BLF）、
          <Text code>加载 DBC</Text>，右侧显示当前源文件与 DBC 数量。
        </Paragraph>
        <Paragraph style={{ fontSize: 13 }}>
          <b>主区域</b>：左侧为 DBC 结构与信号布局面板（46% 宽度），右侧为结果页签区（信号解析 / CAN 报文日志 / 物理量 CSV）。
        </Paragraph>

        {/* ============ 4. DBC 面板 ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>四、DBC 结构与信号布局面板（左侧）</Title>
        <FeatureList items={[
          <span><b>搜索</b>：输入框支持按<b>消息名 / ID / 信号名</b>检索（如 <Text code>0x100</Text> 或 <Text code>Speed</Text>）；点击头部「清空」按钮可一键清空搜索框。</span>,
          <span><b>消息列表</b>：每条消息显示 ID（十六进制）、名称、发送/接收节点、DLC 字节数及信号数量。点击消息行可<b>展开/折叠</b>信号列表，展开列表固定显示约 8 行，超出时出现<b>滚动条</b>，避免长信号列表遮挡右侧布局。</span>,
          <span><b>信号行</b>：显示信号名称、位范围（如 <Text code>64|16@1+</Text> 表示 startBit 64、长度 16 位、Intel 小端、无符号）、缩放因子与偏移（factor/offset）。点击复选框即可选择该信号，行首色块与曲线颜色一一对应。</span>,
          <span><b>布局视图</b>：展开消息后下方显示<b>字节布局</b>（B0–Bn），按 DLC 动态渲染（CAN FD 64 字节显示 B0–B63），每个字节内用色块标出各信号占用的位，悬停可见信号名与位信息。</span>,
          <span><b>工具按钮</b>：顶部「全选信号 / 取消全选」作用于当前检索结果；每条消息行有「本消息全选/全不选」；「DBC 原文」按钮以弹窗查看原始 DBC 文件内容；「重新加载」可重新选择 DBC。</span>,
        ]} />

        {/* ============ 5. 信号解析 ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>五、信号解析页签 <ThunderboltOutlined /></Title>
        <Paragraph style={{ fontSize: 13 }}>
          勾选信号后自动进入此页签，顶部展示「已选信号」标签列表（可点击 <Text code>×</Text> 移除单个信号）。
        </Paragraph>
        <FeatureList items={[
          <span><b>数值表格</b>：每行一条报文，列出 <Text code>时间戳 / 消息ID / 各信号物理值</Text>。物理值 = 原始值 × factor + offset（与 DBC 定义一致），数据量大时自动<b>抽样</b>以保证流畅（可在表格上方调整步长）。</span>,
          <span><b>曲线图</b>：以时间戳为横轴绘制各信号曲线，支持「显示全部 / 只显示当前勾选」切换；鼠标可<b>缩放/平移</b>；Y 轴根据可见曲线自动取值，常值曲线也会给出合理范围；图例上点击曲线名可隐藏/显示对应曲线。</span>,
          <span><b>字节视图</b>：表格左侧同步展示每个信号的<b>原始字节</b>与解码位（HEX），便于核对字节序与位偏移。</span>,
          <span><b>布局视图</b>：页面底部展示所选消息的位布局图，蓝色为已选信号，灰色为未选信号。</span>,
        ]} />

        {/* ============ 6. CAN 报文日志 ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>六、CAN 报文日志页签 <TableOutlined /></Title>
        <FeatureList items={[
          <span><b>报文表</b>：展示全部已加载报文的 <Text code>时间 / ID / 名称 / DLC / 数据(HEX)</Text>，ID 支持颜色标注（未在 DBC 中定义的 ID 显示为灰色）。</span>,
          <span><b>过滤</b>：表格上方支持按 ID / 方向过滤，快速聚焦目标报文。</span>,
          <span><b>行内 DBC 解码</b>：结合已加载的 DBC，将帧内已知信号实时解码为物理值列。</span>,
          <span><b>导出 ASC</b>：页签底部「导出 ASC」可将当前（过滤后）的报文列表重新写回 ASC 文件，实现数据裁剪/重组。</span>,
        ]} />

        {/* ============ 7. 物理量 CSV ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>七、物理量 CSV 页签 <SyncOutlined /></Title>
        <Paragraph style={{ fontSize: 13 }}>
          本页签面向「已有物理量数据、需要逆向生成 CAN 报文」的场景（如标定数据回放、HIL 仿真激励）。
        </Paragraph>
        <FeatureList items={[
          <span><b>加载 CSV</b>：点击「加载 CSV」选择文件。CSV 首行为表头，需包含时间戳列（<Text code>t</Text>）与各信号列；程序依据 DBC 自动匹配信号 → 所属消息 ID。</span>,
          <span><b>CRC 校验</b>：在「CRC 算法选择」下拉框中指定校验算法（CRC8/CRC16 系列或 NONE）。转换时若 DBC 消息包含 Checksum 信号，将按所选算法<b>自动计算并填充</b>；选择 NONE 则保留 CSV 中的原始校验值。</span>,
          <span><b>转换 ASC</b>：点击「转换为 ASC」后选择保存路径，程序将物理值按 DBC 的 factor/offset 反算为原始字节、打包为 CAN 帧（含时间戳、通道、方向），生成 ASC 文件并自动载入报文日志。</span>,
        ]} />

        {/* ============ 8. 格式说明 ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>八、支持格式与约定</Title>
        <Paragraph style={{ fontSize: 13, marginBottom: 4 }}>
          <b>ASC（Vector CANalyzer 文本格式）</b>
        </Paragraph>
        <StepList items={[
          <span>头部信息行（<Text code>date / base hex / timestamps absolute</Text> 等），帧行格式：
            <Text code>时间 通道 方向 IDx DLC [数据字节]</Text>。</span>,
          <span>支持普通 CAN（DLC≤8）与 CAN FD（DLC 可至 64，带 <Text code>d</Text> 标记）。</span>,
        ]} />
        <Paragraph style={{ fontSize: 13, marginBottom: 4 }}>
          <b>BLF（Vector 二进制日志）</b>
        </Paragraph>
        <StepList items={[
          <span>解析 CAN/CAN FD 对象消息块；支持从 ASC 转换生成（工具栏「ASC→BLF」）。</span>,
        ]} />
        <Paragraph style={{ fontSize: 13, marginBottom: 4 }}>
          <b>DBC（Vector CANdb++ 数据库）</b>
        </Paragraph>
        <StepList items={[
          <span>支持 <Text code>BO_ 消息定义</Text>、<Text code>SG_ 信号定义</Text>（含 <Text code>startBit|length@byteOrder valueType</Text>、factor、offset、单位、接收节点）、<Text code>VAL_ 枚举</Text>、<Text code>CM_ 注释</Text>。</span>,
          <span>支持 CAN FD 64 字节消息（信号位可延伸至 bit 511 / B63）。</span>,
          <span>若 DBC 中存在 CRC/Checksum 信号，物理量 CSV 转换时会自动计算。</span>,
        ]} />
        <Paragraph style={{ fontSize: 13, marginBottom: 4 }}>
          <b>物理量 CSV</b>
        </Paragraph>
        <StepList items={[
          <span>首行为表头；<Text code>t</Text> 列为时间戳（秒，可含小数）；其余列名需与 DBC 信号名一致（大小写不敏感）。</span>,
        ]} />

        {/* ============ 9. FAQ ============ */}
        <Title level={4} style={{ marginBottom: 6 }}>九、常见问题（FAQ）</Title>
        <FeatureList items={[
          <span><b>Q：曲线图为什么有的曲线看不到？</b>—— 点击图例中的曲线名可隐藏/显示；若信号为常值，曲线贴近 Y 轴，可先隐藏其他曲线后查看。</span>,
          <span><b>Q：信号数值与预期不符？</b>—— 检查 DBC 中 factor/offset：物理值 = raw × factor + offset；检查字节序（Intel=小端 / Motorola=大端）是否与总线定义一致。</span>,
          <span><b>Q：CAN FD 64 字节消息布局只显示 8 个字节？</b>—— 请确认 DBC 中该消息 DLC 定义为 64（<Text code>BO_ ID NAME: 64 SENDER</Text>），布局视图按 DLC 动态渲染 B0–B63。</span>,
          <span><b>Q：数据量大时卡顿？</b>—— 表格与曲线会自动抽样显示；可减少勾选信号数量、或在表格上方增大抽样步长。</span>,
          <span><b>Q：如何将 CSV 物理量转成报文？</b>—— 在「物理量 CSV」页签加载 CSV → 选择 CRC 算法 → 点击「转换为 ASC」，生成后自动载入报文日志。</span>,
          <span><b>Q：找不到信号？</b>—— 在左侧面板搜索框输入信号名；确认 DBC 已正确加载（头部显示 DBC 消息数）。</span>,
        ]} />

        <Divider style={{ margin: '12px 0 4px' }} />
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
          <QuestionCircleOutlined /> 提示：本手册可在应用右上角「使用手册」按钮随时查阅。更多示例数据（ASC/BLF/DBC）位于仓库 <Text code>TestExample/</Text> 目录。
        </Paragraph>
      </Typography>
    </div>
  </Modal>
);

export default HelpModal;
