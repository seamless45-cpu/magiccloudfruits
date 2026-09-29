import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Signals the inline boot watchdog in index.html that the module executed.
(window as unknown as { __appStarted?: boolean }).__appStarted = true;

createRoot(document.getElementById("root")!).render(<App />);