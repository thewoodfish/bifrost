import { Nav } from "./components/Nav";
import { Notice } from "./components/ui";
import { useProtocol } from "./lib/protocol";
import { Link, useRoute } from "./lib/router";
import { Borrow } from "./pages/Borrow";
import { Landing } from "./pages/Landing";
import { Ledger } from "./pages/Ledger";
import { PortfolioPage } from "./pages/Portfolio";
import { Valuer } from "./pages/Valuer";
import { Verify } from "./pages/Verify";
import { useWallet } from "./lib/wallet";

function NotFound() {
  return (
    <div className="shell page">
      <div className="gate card">
        <h1 className="h1">Nothing here.</h1>
        <Link to="/" className="btn btn-primary">Home</Link>
      </div>
    </div>
  );
}

function Page({ route }: { route: string[] }) {
  const [section, arg] = route;
  const numeric = arg !== undefined && /^\d+$/.test(arg);
  switch (section) {
    case undefined: return <Landing />;
    case "app": return <Borrow />;
    case "p": return numeric ? <PortfolioPage key={arg} id={arg} /> : <NotFound />;
    case "valuer": return <Valuer />;
    case "ledger": return <Ledger />;
    case "verify": return numeric ? <Verify key={arg} id={arg} /> : <NotFound />;
    default: return <NotFound />;
  }
}

export function App() {
  const route = useRoute();
  const { error } = useWallet();
  const { error: syncError, synced } = useProtocol();

  return (
    <div className="app">
      <Nav route={route} />
      {error && route[0] !== "app" && (
        <div className="shell banner"><Notice tone="red">{error}</Notice></div>
      )}
      {syncError && !synced && (
        <div className="shell banner">
          <Notice tone="amber" title="Having trouble reaching the chains">{syncError}</Notice>
        </div>
      )}
      <main>
        <Page route={route} />
      </main>
    </div>
  );
}
