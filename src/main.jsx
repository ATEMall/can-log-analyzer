import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';  // Use full version
// import App from './App-simple';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
