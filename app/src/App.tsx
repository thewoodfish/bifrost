import { AppShell } from "./components/AppShell";
import { Empty, Icon } from "./components/ui";
import { Link, useRoute } from "./lib/router";
import { Borrow } from "./pages/Borrow";
import { Landing } from "./pages/Landing";
import { Ledger } from "./pages/Ledger";
import { PortfolioPage } from "./pages/Portfolio";
import { Valuer } from "./pages/Valuer";
import { Verify } from "./pages/Verify";

function NotFound() {
  return (
    <div className="page">
      <div className="card">
        <Empty icon={<Icon.Search size={20} />} title="Nothing here.">
          <Link to="/app" className="btn btn-primary">Go to dashboard</Link>
        </Empty>
      </div>
    </div>
  );
}

function Page({ route }: { route: string[] }) {
  const [section, arg] = route;
  const numeric = arg !== undefined && /^\d+$/.test(arg);
  switch (section) {
    case "app": return <Borrow />;
    case "p": return numeric ? <PortfolioPage key={arg} id={arg} /> : <NotFound />;
    case "valuer": return <Valuer />;
    case "ledger": return <Ledger />;
    case "verify": return numeric ? <Verify key={arg} id={arg} /> : <NotFound />;
    default: return <NotFound />;
  }
}

/** The marketing site stands alone; everything else lives in the app shell. */
export function App() {
  const route = useRoute();
  if (route[0] === undefined) return <Landing />;
  return (
    <AppShell route={route}>
      <Page route={route} />
    </AppShell>
  );
}
