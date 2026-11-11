import { darkTheme, lightTheme, type GlobalTheme, type GlobalThemeOverrides } from 'naive-ui'
import type { ResolvedTheme } from './useTheme'

/**
 * Naive UI 主题映射
 * 把 design/视觉稿.html 里的设计令牌 1:1 映射成 Naive 的 themeOverrides，
 * 这样组件库的外观与自研组件完全一致，切主题时也不需要改任何组件代码。
 */

const fontFamily =
  '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Segoe UI",system-ui,-apple-system,sans-serif'

const radius = { borderRadius: '9px', borderRadiusSmall: '7px' }

const darkOverrides: GlobalThemeOverrides = {
  common: {
    ...radius,
    fontFamily,
    bodyColor: '#0A0C12',
    cardColor: '#12151E',
    modalColor: '#1A1F2B',
    popoverColor: '#1A1F2B',
    tableColor: '#12151E',
    inputColor: '#12151E',
    tableHeaderColor: '#12151E',
    textColorBase: '#E8EAF0',
    textColor1: '#E8EAF0',
    textColor2: '#8B92A6',
    textColor3: '#5C6377',
    borderColor: 'rgba(255,255,255,.08)',
    dividerColor: 'rgba(255,255,255,.08)',
    hoverColor: 'rgba(255,255,255,.04)',
    primaryColor: '#6C7BFF',
    primaryColorHover: '#7D8AFF',
    primaryColorPressed: '#5A68E8',
    primaryColorSuppl: '#6C7BFF',
    infoColor: '#6C7BFF',
    successColor: '#35D0BA',
    warningColor: '#FFB86B',
    errorColor: '#F0655F',
  },
  Card: { borderColor: 'rgba(255,255,255,.08)', color: '#12151E' },
  Input: {
    color: '#12151E',
    colorFocus: '#12151E',
    border: '1px solid rgba(255,255,255,.08)',
    borderHover: '1px solid rgba(255,255,255,.14)',
    borderFocus: '1px solid #6C7BFF',
    boxShadowFocus: '0 0 0 2px rgba(108,123,255,.14)',
    placeholderColor: '#5C6377',
    textColor: '#E8EAF0',
    caretColor: '#6C7BFF',
  },
  Button: { fontWeight: '400', fontWeightStrong: '500' },
  Tag: { borderRadius: '99px' },
  DataTable: {
    thColor: '#12151E',
    thTextColor: '#5C6377',
    tdColor: '#12151E',
    tdColorHover: 'rgba(255,255,255,.03)',
    borderColor: 'rgba(255,255,255,.08)',
  },
  Pagination: { itemColor: 'transparent', itemColorActive: '#6C7BFF' },
  Message: { color: '#1A1F2B', textColor: '#E8EAF0', borderRadius: '10px' },
  Dialog: { color: '#1A1F2B', borderRadius: '12px' },
}

const lightOverrides: GlobalThemeOverrides = {
  common: {
    ...radius,
    fontFamily,
    bodyColor: '#F5F6FA',
    cardColor: '#FFFFFF',
    modalColor: '#FFFFFF',
    popoverColor: '#FFFFFF',
    tableColor: '#FFFFFF',
    inputColor: '#F2F4F9',
    tableHeaderColor: '#FFFFFF',
    textColorBase: '#181B26',
    textColor1: '#181B26',
    textColor2: '#5C6478',
    textColor3: '#8C93A6',
    borderColor: 'rgba(20,24,45,.09)',
    dividerColor: 'rgba(20,24,45,.09)',
    hoverColor: 'rgba(20,24,45,.03)',
    primaryColor: '#5563E0',
    primaryColorHover: '#4756D8',
    primaryColorPressed: '#3C4BC4',
    primaryColorSuppl: '#5563E0',
    infoColor: '#5563E0',
    successColor: '#0E9E8C',
    warningColor: '#D97706',
    errorColor: '#DC4B45',
  },
  Card: { borderColor: 'rgba(20,24,45,.09)', color: '#FFFFFF' },
  Input: {
    color: '#F2F4F9',
    colorFocus: '#FFFFFF',
    border: '1px solid transparent',
    borderHover: '1px solid rgba(20,24,45,.16)',
    borderFocus: '1px solid #5563E0',
    boxShadowFocus: '0 0 0 2px rgba(85,99,224,.12)',
    placeholderColor: '#8C93A6',
    textColor: '#181B26',
    caretColor: '#5563E0',
  },
  Button: { fontWeight: '400', fontWeightStrong: '500' },
  Tag: { borderRadius: '99px' },
  DataTable: {
    thColor: '#FFFFFF',
    thTextColor: '#8C93A6',
    tdColor: '#FFFFFF',
    tdColorHover: 'rgba(20,24,45,.03)',
    borderColor: 'rgba(20,24,45,.09)',
  },
  Pagination: { itemColor: 'transparent', itemColorActive: '#5563E0' },
  Message: { color: '#FFFFFF', textColor: '#181B26', borderRadius: '10px' },
  Dialog: { color: '#FFFFFF', borderRadius: '12px' },
}

export function naiveTheme(resolved: ResolvedTheme): GlobalTheme {
  return resolved === 'dark' ? darkTheme : lightTheme
}

export function naiveOverrides(resolved: ResolvedTheme): GlobalThemeOverrides {
  return resolved === 'dark' ? darkOverrides : lightOverrides
}
