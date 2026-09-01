import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import "./index.css";
import { Capacitor } from "@capacitor/core";

// Add Capacitor iOS detection and body class
function detectCapacitorPlatform() {
  if (Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform()) {
    document.body.classList.add('capacitor-app', 'capacitor-ios', 'ios-capacitor-app');
    console.log('[Main] Added Capacitor iOS classes to body');
  }
}

// Run platform detection and then render
detectCapacitorPlatform();
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
