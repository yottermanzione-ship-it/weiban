import { theme, type ThemeConfig } from 'antd';

export type AdminMode = 'dark' | 'light';

export const FONT_SANS =
  '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
export const FONT_MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", SFMono-Regular, ui-monospace, Consolas, monospace';

export function getWeibanTheme(mode: AdminMode): ThemeConfig {
  const dark = mode === 'dark';
  const accent = dark ? '#10b981' : '#059669';
  const canvas = dark ? '#06080d' : '#f3f5f8';
  const surface = dark ? '#0f131d' : '#ffffff';
  const surface2 = dark ? '#151b28' : '#f8fafc';
  const sidebar = dark ? '#0a0d14' : '#ffffff';
  const border = dark ? 'rgba(255,255,255,0.08)' : '#e2e8f0';
  const text = dark ? '#f3f4f6' : '#0f172a';
  const muted = dark ? '#9ca3af' : '#475569';

  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: accent,
      colorSuccess: accent,
      colorWarning: dark ? '#f59e0b' : '#b45309',
      colorError: dark ? '#fb7185' : '#be123c',
      colorInfo: dark ? '#38bdf8' : '#0369a1',
      colorLink: dark ? '#34d399' : '#047857',
      colorTextBase: text,
      colorText: text,
      colorTextSecondary: muted,
      colorTextTertiary: dark ? '#858e9d' : '#64748b',
      colorTextPlaceholder: dark ? '#858e9d' : '#64748b',
      colorBgBase: canvas,
      colorBgLayout: canvas,
      colorBgContainer: surface,
      colorBgElevated: dark ? surface2 : surface,
      colorBorder: dark ? 'rgba(255,255,255,0.17)' : '#cbd5e1',
      colorBorderSecondary: border,
      fontFamily: FONT_SANS,
      fontFamilyCode: FONT_MONO,
      fontSize: 14,
      borderRadius: 8,
      borderRadiusLG: 14,
    },
    components: {
      Layout: {
        siderBg: sidebar,
        bodyBg: 'transparent',
        headerBg: dark ? 'rgba(6,8,13,0.82)' : 'rgba(255,255,255,0.85)',
        headerHeight: 64,
        headerPadding: '0 28px',
      },
      Menu: {
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
        itemColor: muted,
        itemHoverBg: dark ? 'rgba(255,255,255,0.04)' : '#f1f5f9',
        itemSelectedBg: dark ? 'rgba(16,185,129,0.12)' : '#ecfdf5',
        itemSelectedColor: dark ? '#34d399' : '#047857',
        itemHeight: 36,
        itemMarginInline: 0,
        itemMarginBlock: 4,
        collapsedWidth: 70,
        iconSize: 16,
        collapsedIconSize: 18,
        groupTitleColor: dark ? '#858e9d' : '#64748b',
        groupTitleFontSize: 11,
      },
      Table: {
        headerBg: surface2,
        headerColor: muted,
        headerSplitColor: border,
        borderColor: border,
        rowHoverBg: dark ? '#142528' : '#ecfdf5',
        rowSelectedBg: dark ? '#13302c' : '#ecfdf5',
        rowSelectedHoverBg: dark ? '#193a34' : '#d1fae5',
        cellPaddingBlock: 16,
        cellPaddingBlockMD: 12,
        cellPaddingBlockSM: 7,
        cellPaddingInline: 14,
        cellPaddingInlineMD: 14,
        cellPaddingInlineSM: 12,
        stickyScrollBarBg: dark ? '#526071' : '#94a3b8',
        headerBorderRadius: 0,
      },
      Card: { headerHeight: 46, headerFontSize: 14 },
      Drawer: { colorBgElevated: sidebar, paddingLG: 20 },
      Form: { labelColor: muted, verticalLabelPadding: '0 0 4px', itemMarginBottom: 16 },
      Button: {
        primaryShadow: 'none',
        primaryColor: dark ? '#06251b' : '#ffffff',
        fontWeight: 550,
      },
      Segmented: {
        trackBg: surface2,
        itemColor: muted,
        itemSelectedBg: dark ? '#10b981' : '#047857',
        itemSelectedColor: dark ? '#06251b' : '#ffffff',
        itemHoverBg: dark ? 'rgba(255,255,255,0.06)' : '#e2e8f0',
      },
      Tag: { defaultBg: surface2 },
    },
  };
}
