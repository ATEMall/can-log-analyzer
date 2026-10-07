const fs = require('fs');
const path = require('path');
const { parseA2LDocument, parseA2LFile, convertToPhysical, detectXcpTransport } = require('../a2l');

const UDS_DIR = path.join(__dirname, '..', '..', 'TestExample', 'roadmap_v3x', 'uds_xcp');
const XCPLITE_DIR = path.join(__dirname, '..', '..', 'TestExample', 'roadmap_v3x', 'xcp_xcplite');
const read = (p) => fs.readFileSync(p, 'utf8');

// 手工 grep 基线（独立复核：Select-String "/begin MEASUREMENT" 等计数）
const BASELINE = {
  'ASAP2_Demo_V161.a2l': { measurements: 25, characteristics: 50, compuMethods: 16 },
  'ASAP2_Demo_V171.a2l': { measurements: 31, characteristics: 87, compuMethods: 19 },
  'freeTest.a2l': { measurements: 1, characteristics: 4, compuMethods: 3 }
};
const XCPLITE_BASELINE = {
  'hello_xcp_autodetect.a2l': { measurements: 9, characteristics: 3, compuMethods: 2 },
  'c_demo_autodetect.a2l': { measurements: 18, characteristics: 9, compuMethods: 1 },
  'no_a2l_demo.a2l': { measurements: 34, characteristics: 0, compuMethods: 2 },
  'a2l_test_autodetect.a2l': { measurements: 20, characteristics: 49, compuMethods: 4 }
};

describe('B2 · A2L 素材验收（与手工 grep 计数对拍）', () => {
  Object.entries(BASELINE).forEach(([file, exp]) => {
    it(`${file}：MEASUREMENT / CHARACTERISTIC / COMPU_METHOD 计数一致`, () => {
      const doc = parseA2LDocument(read(path.join(UDS_DIR, file)));
      expect(doc.stats.measurements).toBe(exp.measurements);
      expect(doc.stats.characteristics).toBe(exp.characteristics);
      expect(doc.stats.compuMethods).toBe(exp.compuMethods);
      expect(doc.errors).toEqual([]);
    });
  });

  Object.entries(XCPLITE_BASELINE).forEach(([file, exp]) => {
    it(`XCPlite ${file}：计数一致（MIT 素材）`, () => {
      const doc = parseA2LDocument(read(path.join(XCPLITE_DIR, file)));
      expect(doc.stats.measurements).toBe(exp.measurements);
      expect(doc.stats.characteristics).toBe(exp.characteristics);
      expect(doc.stats.compuMethods).toBe(exp.compuMethods);
    });
  });

  it('XCPlite：内联 ECU_ADDRESS 与地址扩展可提取', () => {
    const doc = parseA2LDocument(read(path.join(XCPLITE_DIR, 'hello_xcp_autodetect.a2l')));
    const t1 = doc.measurements.find((m) => m.name === 't1');
    expect(t1).toBeTruthy();
    expect(t1.address).toBe(0x10090); // 内联 ECU_ADDRESS 0x10090
    expect(t1.addressExtension).toBe(2);
    expect(t1.hasXcpIfData).toBe(true);
  });

  it('XCPlite：标定量地址与 PHYS_UNIT 可提取', () => {
    const doc = parseA2LDocument(read(path.join(XCPLITE_DIR, 'a2l_test_autodetect.a2l')));
    const c = doc.characteristics.find((x) => x.name === 'static_counter_max');
    expect(c.address).toBe(0xfc58);
    expect(c.physUnit).toBe('ms');
  });

  it('XCP 传输层：XCPlite 为 autodetect（无显式块，不得默认成 CAN）', () => {
    const doc = parseA2LDocument(read(path.join(XCPLITE_DIR, 'hello_xcp_autodetect.a2l')));
    const t = detectXcpTransport(doc);
    expect(t.explicit).toBe(false);
    expect(t.types).toEqual([]);
    expect(t.isCan).toBe(false); // 防「把以太网当 CAN」的误判
  });

  // 验收⑤：XCP DEVICE 须为 XCP_ON_CAN。真实 ECU A2L 由 XCP_EIS_DIR 指向，
  // 缺失时显式跳过（未执行即未验证，不静默通过）。
  const EIS_DIR = process.env.XCP_EIS_DIR;
  // 云盘会同步出 macOS AppleDouble 文件 `._xxx.a2l`（二进制），需排除后取最大的真实 A2L。
  const eisA2l = EIS_DIR
    ? fs.readdirSync(EIS_DIR)
      .filter((f) => /\.a2l$/i.test(f) && !/^\._/.test(f))
      .map((f) => ({ f, size: fs.statSync(path.join(EIS_DIR, f)).size }))
      .sort((a, b) => b.size - a.size)[0].f
    : null;
  const maybeEis = eisA2l ? it : it.skip;

  maybeEis('验收⑤：真实 ECU A2L 显式声明 XCP_ON_CAN', () => {
    const doc = parseA2LDocument(read(path.join(EIS_DIR, eisA2l)));
    const t = detectXcpTransport(doc);
    expect(t.explicit).toBe(true);
    expect(t.types).toContain('XCP_ON_CAN');
    expect(t.isCan).toBe(true);
    // 不得同时声明以太网/USB 等其它传输层（否则传输层歧义）
    expect(t.types).toEqual(['XCP_ON_CAN']);
  }, 120000);
});

describe('B2 · /include 嵌套展开', () => {
  it('三层嵌套：展开文件数与 MEASUREMENT 总数正确', () => {
    const r = parseA2LFile(path.join(UDS_DIR, 'nested_include', 'root.a2l'));
    expect(r.missingIncludes).toEqual([]);
    expect(r.expandedFiles).toHaveLength(3);
    expect(r.maxDepth).toBe(2); // 0=root, 1=level2, 2=level3 → 三层
    expect(r.document.stats.measurements).toBe(6); // 1 + 2 + 3
    const names = r.document.measurements.map((m) => m.name).sort();
    expect(names).toEqual(['m_l2a', 'm_l2b', 'm_l3a', 'm_l3b', 'm_l3c', 'm_root']);
  });

  it('官方嵌套用例 TEST_Nested_Includes.a2l：多层 INCLUDE 展开成功', () => {
    const r = parseA2LFile(path.join(UDS_DIR, 'TEST_Nested_Includes.a2l'));
    // 官方素材未随附子文件，已按官方注释自撰最小可解析内容补齐（见 submodules/ 顶部说明）
    expect(r.missingIncludes).toEqual([]);
    expect(r.expandedFiles).toHaveLength(3); // root + MODULE_INCLUDES + SUB_MODULE_INCLUDES
    expect(r.maxDepth).toBe(2);
    expect(r.document.stats.measurements).toBe(3); // 2 + 1
    expect(r.document.measurements.map((m) => m.name).sort()).toEqual(['m_inc_a', 'm_inc_b', 'm_inc_c']);
  });

  it('缺失的 include 被记录（不静默丢弃）', () => {
    const r = parseA2LFile(path.join(UDS_DIR, 'nested_include', 'root.a2l'), {
      exists: (p) => !/level3/.test(p), // 人为让第 3 层缺失
      readFile: (p) => fs.readFileSync(p, 'utf8')
    });
    expect(r.missingIncludes.some((x) => /level3\.a2l$/.test(x))).toBe(true);
    expect(r.document.stats.measurements).toBe(3); // 已展开的两层：1 + 2
  });

  it('注释里的 /INCLUDE 不是指令（不得被当成缺失文件）', () => {
    const resources = {
      'root.a2l': '/* 本文件会 /INCLUDE "submodules/MODULE_INCLUDES.a2l" */\n'
        + '/begin PROJECT P "" /end PROJECT\n/INCLUDE "real.a2l"\n',
      'real.a2l': '/begin MODULE M "" /end MODULE\n'
    };
    const r = parseA2LFile('root.a2l', {
      exists: (p) => path.basename(p) in resources,
      readFile: (p) => resources[path.basename(p)]
    });
    expect(r.missingIncludes).toEqual([]);
    expect(r.expandedFiles).toEqual(['root.a2l', 'real.a2l']);
  });

  it('循环 include 不会无限递归', () => {
    const resources = {
      'a.a2l': '/begin PROJECT A "" /end PROJECT\n/include "b.a2l"\n',
      'b.a2l': '/begin MODULE B "" /end MODULE\n/include "a.a2l"\n'
    };
    const r = parseA2LFile('a.a2l', {
      exists: (p) => path.basename(p) in resources,
      readFile: (p) => resources[path.basename(p)]
    });
    expect(r.expandedFiles).toHaveLength(2);
    expect(r.missingIncludes).toEqual([]);
  });
});

describe('B2 · COMPU_METHOD 数值换算', () => {
  it('LINEAR：f(raw) = a*raw + b', () => {
    const cm = { name: 'cm', type: 'LINEAR', coeffs: [0.125, 0] };
    expect(convertToPhysical(cm, 800)).toBe(100);
    expect(convertToPhysical(cm, 0)).toBe(0);
  });

  it('RAT_FUNC：有理函数换算', () => {
    // f(x) = (a x^2 + b x + c) / (d x^2 + e x + f)，此处 a=b=d=e=0 → c/f
    const cm = { name: 'cm', type: 'RAT_FUNC', coeffs: [0, 1, 0, 0, 0, 2] };
    expect(convertToPhysical(cm, 10)).toBe(5); // (10)/(2)
  });

  it('TAB_INTP：线性插值，TAB_NOINTP：取最接近', () => {
    const intp = { name: 'cm', type: 'TAB_INTP', pairs: [[0, 0], [10, 100]] };
    expect(convertToPhysical(intp, 5)).toBe(50);
    expect(convertToPhysical(intp, -1)).toBe(0); // 下界钳位
    expect(convertToPhysical(intp, 99)).toBe(100); // 上界钳位
    const nointp = { name: 'cm', type: 'TAB_NOINTP', pairs: [[0, 0], [10, 100]] };
    expect(convertToPhysical(nointp, 6)).toBe(100); // 更接近 10
    expect(convertToPhysical(nointp, 3)).toBe(0);
  });

  it('NO_COMPU_METHOD：恒等换算', () => {
    expect(convertToPhysical({ name: 'NO_COMPU_METHOD', type: 'NO_COMPU_METHOD' }, 42)).toBe(42);
  });

  it('未支持类型（如文本表）显式返回 null，不伪造数值', () => {
    expect(convertToPhysical({ name: 'cm', type: 'TAB_VERB', pairs: [] }, 1)).toBe(null);
  });

  it('真实素材换算：V161 的 COMPU_METHOD 可用', () => {
    const doc = parseA2LDocument(read(path.join(UDS_DIR, 'ASAP2_Demo_V161.a2l')));
    const linear = doc.compuMethods.find((c) => c.type === 'LINEAR');
    expect(linear).toBeTruthy();
    expect(typeof convertToPhysical(linear, 1)).toBe('number');
  });

  // 验收③：LINEAR 与 TAB 型（PLAN 称 TABLPARM，1.6+ 为 TAB_INTP）各 ≥1 例，
  // 且换算结果与手工计算一致。
  it('验收③：LINEAR 手工换算一致（V161 CM.LINEAR.MUL_2：phys = 2*raw）', () => {
    const doc = parseA2LDocument(read(path.join(UDS_DIR, 'ASAP2_Demo_V161.a2l')));
    const cm = doc.compuMethods.find((c) => c.name === 'CM.LINEAR.MUL_2');
    expect(cm.coeffs).toEqual([2, 0]); // COEFFS 2 0
    expect(convertToPhysical(cm, 21)).toBe(42); // 手工：2*21 + 0 = 42
    expect(convertToPhysical(cm, 0)).toBe(0);
  });

  it('验收③：TAB_INTP 经 COMPU_TAB_REF 取表，插值与手工计算一致', () => {
    const doc = parseA2LDocument(read(path.join(UDS_DIR, 'ASAP2_Demo_V161.a2l')));
    const cm = doc.compuMethods.find((c) => c.name === 'CM.TAB_INTP.DEFAULT_VALUE');
    expect(cm.compuTabRef).toBe('CM.TAB_INTP.DEFAULT_VALUE.REF');
    expect(cm.tabRefMissing).toBeUndefined();
    // COMPU_TAB 声明 12 组：(-3,98) (-1,99) (0,100) (2,102) (4,104) (5,105)
    //                      (6,106) (7,107) (8,108) (9,109) (10,110) (13,111)
    expect(cm.pairs).toEqual([
      [-3, 98], [-1, 99], [0, 100], [2, 102], [4, 104], [5, 105],
      [6, 106], [7, 107], [8, 108], [9, 109], [10, 110], [13, 111]
    ]);

    // 手工插值：raw=1 落在 0→100 与 2→102 之间，t=0.5 → 100 + 0.5*2 = 101
    expect(convertToPhysical(cm, 1)).toBeCloseTo(101, 10);
    // raw=3 落在 2→102 与 4→104 之间，t=0.5 → 103
    expect(convertToPhysical(cm, 3)).toBeCloseTo(103, 10);
    // 越界钳位：小于最小 → 98；大于最大 → 111
    expect(convertToPhysical(cm, -10)).toBe(98);
    expect(convertToPhysical(cm, 1000)).toBe(111);
  });

  it('COMPU_TAB 块解析：表项数量与声明一致', () => {
    const doc = parseA2LDocument(read(path.join(UDS_DIR, 'ASAP2_Demo_V161.a2l')));
    expect(doc.compuTabs).toHaveLength(4);
    for (const t of doc.compuTabs) {
      expect(t.pairCountMismatch).toBe(false);
      expect(t.pairs.length).toBe(t.numberValuePairs);
    }
  });
});
