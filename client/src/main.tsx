import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import "./index.css";

// Add Capacitor iOS detection and body class
async function detectCapacitorPlatform() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform()) {
      document.body.classList.add('capacitor-app', 'capacitor-ios', 'ios-capacitor-app');
      console.log('[Main] Added Capacitor iOS classes to body');
    }
  } catch {
    console.log('[Main] Capacitor not available, running in web mode');
  }
}

// Run platform detection and then render
detectCapacitorPlatform().then(() => {
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
});
