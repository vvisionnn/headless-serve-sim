import { createRoot } from "react-dom/client";
import { App } from "./app";
import { AppProvider } from "./lib/store";

createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
