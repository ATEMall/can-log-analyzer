// =====================================================================
// v2.2 R9 — shared signal palette.
//
// R9 spec keeps signal curves / bit-layout hues IDENTICAL in light & dark
// themes (they carry semantic colour, not surface colour), so this palette
// is a plain constant array — never driven by [data-theme]. It is the
// single source of truth for every signal colouring surface:
//   - SignalChart  (curve stroke + filter-bar tag fill)
//   - SignalLayoutView (bit-layout grid cells + legends)
//
// Index order is deterministic: signal #0 is always the first colour,
// #1 the second, ... wrapping around when a view has more signals than
// colours. SignalChart cycles the whole palette; its tests pin curve #0
// to '#1890ff' and curve #7 to '#2f54eb'.
// =====================================================================

export const SIGNAL_PALETTE = [
  '#1890ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1',
  '#13c2c2', '#f5222d', '#2f54eb', '#faad14', '#a0d911',
  '#531dab', '#08979c', '#c41d7f', '#389e0d', '#d46b08'
];

export const SIGNAL_PALETTE_LENGTH = SIGNAL_PALETTE.length;
