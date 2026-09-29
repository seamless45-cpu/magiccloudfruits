import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Signals the inline boot watchdog in index.html that the module executed.
(window as unknown as { __appStarted?: boolean }).__appStarted = true;
(window as unknown as { __bootProgress?: (p: number, label?: string) => void }).__bootProgress?.(0.32, 'Building arena');

createRoot(document.getElementById("root")!).render(<App />);