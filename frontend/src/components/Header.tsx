import type { ConnectionStatus } from "../hooks/useOverlayFeed";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  closed: "Disconnected",
  error: "Connection error",
};

export function Header({ status }: { status: ConnectionStatus }) {
  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <path
              d="M12 2 3 7v6c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7l-9-5Z"
              fill="currentColor"
              opacity="0.25"
            />
            <path d="M8 12.5 11 15l5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <div>
          <h1>Pitch Insights Engine</h1>
          <p className="brand-subtitle">Synthetic match explainability, built on Microsoft Agent Framework &amp; Azure AI Foundry</p>
        </div>
      </div>
      <div className={`status-pill status-${status}`}>
        <span className="status-dot" />
        {STATUS_LABEL[status]}
      </div>
    </header>
  );
}
