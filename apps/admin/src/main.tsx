import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@ant-design/v5-patch-for-react-19';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { App as AntApp } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { AppearanceProvider } from './app/appearance.js';
import './app/weiban-os.css';
import { App } from './app/app.js';

dayjs.locale('zh-cn');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider>
      <AntApp className="admin-app">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </AppearanceProvider>
  </StrictMode>,
);
