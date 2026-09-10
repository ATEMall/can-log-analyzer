import React from 'react';
import ReactDOM from 'react-dom/client';
import ThemedApp from './ThemedApp';  // R9: ConfigProvider + theme host + App
// import App from './App-simple';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>
);
