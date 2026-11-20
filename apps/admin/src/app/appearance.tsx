import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getWeibanTheme, type AdminMode } from './theme.js';

export const DENSITY_OPTIONS = [
  { value: 'small', label: '紧凑' },
  { value: 'middle', label: '舒适' },
  { value: 'large', label: '宽松' },
] as const;
type Density = (typeof DENSITY_OPTIONS)[number]['value'];

export function readPreference<T extends string>(key: string, choices: readonly T[], fallback: T) {
  try {
    const saved = localStorage.getItem(key);
    return choices.find((choice) => choice === saved) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The appearance controls still work when storage is disabled.
  }
}

const AppearanceContext = createContext({
  mode: 'dark' as AdminMode,
  density: undefined as Density | undefined,
  setMode: (_value: AdminMode) => {},
  setDensity: (_value: Density) => {},
});

export function useAppearance() {
  return useContext(AppearanceContext);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AdminMode>(() =>
    readPreference('weiban.os.theme', ['dark', 'light'], 'dark'),
  );
  const [density, setDensity] = useState<Density>(() =>
    readPreference('weiban.os.density', ['small', 'middle', 'large'], 'middle'),
  );
  const tokens = useMemo(() => getWeibanTheme(mode), [mode]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    savePreference('weiban.os.theme', mode);
  }, [mode]);
  useLayoutEffect(() => {
    savePreference('weiban.os.density', density);
  }, [density]);

  return (
    <AppearanceContext.Provider value={{ mode, density, setMode, setDensity }}>
      <ConfigProvider theme={tokens} locale={zhCN} button={{ autoInsertSpace: false }}>
        {children}
      </ConfigProvider>
    </AppearanceContext.Provider>
  );
}
