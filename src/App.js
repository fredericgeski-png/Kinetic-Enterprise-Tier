import React from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Kinetic Enterprise Tier</h1>
        <p>Open-source kill-switch for runaway AI agents</p>
        <div className="info-section">
          <h2>Welcome to Kinetic v1.1 Enterprise</h2>
          <p>
            This is the frontend application for the Kinetic audit, compliance, and security system.
          </p>
          <div className="features">
            <h3>Features:</h3>
            <ul>
              <li>Immutable audit logging with RSA-SHA256 signatures</li>
              <li>Human-in-the-loop kill switch approval workflow</li>
              <li>Role-based access control (RBAC)</li>
              <li>Compliance reporting and data residency</li>
              <li>Real-time agent health monitoring</li>
            </ul>
          </div>
          <p className="note">
            This application now includes Vercel Speed Insights for performance monitoring.
          </p>
        </div>
      </header>
      <SpeedInsights />
    </div>
  );
}

export default App;
