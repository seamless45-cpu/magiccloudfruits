import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// This is the first real application milestone; later progress comes from WebGL setup,
// world construction, and the renderer's first successful frame.
(window as any).__appStarted = true;
(window as any).__arenaBootUpdate?.(22, 'MODULE', 'Application module loaded · preparing the arena');

createRoot(document.getElementById("root")!).render(<App />);