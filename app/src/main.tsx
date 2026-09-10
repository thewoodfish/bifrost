import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WalletProvider } from "./lib/wallet";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>,
);
