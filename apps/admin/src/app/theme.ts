import type { ThemeConfig } from 'antd';

/** 品牌绿：只用于主按钮与选中态。 */
export const BRAND = '#07C160';
export const BRAND_HOVER = '#06AD56';
export const BRAND_SOFT = '#E8F8EF';

export const FONT_SANS =
  '"MiSans", -apple-system, BlinkMacSystemFont, "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: BRAND,
    colorInfo: BRAND,
    colorLink: '#0B7A45',
    colorSuccess: '#0AA35A',
    colorWarning: '#E8912D',
    colorError: '#E5484D',
    colorTextBase: '#1F2329',
    colorTextSecondary: '#5A6068',
    colorTextTertiary: '#8A9099',
    colorBorder: '#DFE3E8',
    colorBorderSecondary: '#EDEFF2',
    colorBgLayout: '#F4F5F7',
    colorBgContainer: '#FFFFFF',
    borderRadius: 6,
    borderRadiusLG: 8,
    fontSize: 13,
    fontFamily: FONT_SANS,
    controlHeight: 32,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF',
      bodyBg: '#F4F5F7',
      headerHeight: 48,
      headerPadding: '0 20px',
    },
    Menu: {
      itemHeight: 34,
      itemMarginInline: 6,
      itemBorderRadius: 6,
      subMenuItemBg: 'transparent',
      itemSelectedBg: BRAND_SOFT,
      itemSelectedColor: '#0B7A45',
      itemHoverBg: '#F4F5F7',
      groupTitleFontSize: 11,
      groupTitleColor: '#98A0A8',
      groupTitleLineHeight: 22,
      collapsedWidth: 56,
      iconSize: 15,
      collapsedIconSize: 16,
    },
    Table: {
      headerBg: '#FAFBFC',
      headerColor: '#5A6068',
      headerSplitColor: '#EDEFF2',
      borderColor: '#EDEFF2',
      cellPaddingBlock: 8,
      cellPaddingInline: 12,
      rowHoverBg: '#F7FBF9',
      headerBorderRadius: 0,
    },
    Card: { paddingLG: 16, headerHeight: 44, headerFontSize: 14 },
    Drawer: { paddingLG: 20, footerPaddingBlock: 12, footerPaddingInline: 20 },
    Modal: { titleFontSize: 15 },
    Statistic: { contentFontSize: 24, titleFontSize: 12 },
    Descriptions: { itemPaddingBottom: 8, colonMarginRight: 4 },
    Form: { labelColor: '#5A6068', verticalLabelPadding: '0 0 4px', itemMarginBottom: 16 },
    Button: { primaryShadow: 'none', fontWeight: 500 },
    Tabs: { horizontalItemPadding: '8px 0', horizontalItemGutter: 20 },
    Tag: { defaultBg: '#F4F5F7' },
    Segmented: { itemSelectedBg: BRAND_SOFT },
    Progress: { defaultColor: BRAND },
  },
};
