import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Jobs' },
  { to: '/chat', label: 'Chat' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/discuss', label: 'Discuss' },
  { to: '/workflows', label: 'Workflows' },
  { to: '/metrics', label: 'Metrics' },
];

export function Layout() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '240px minmax(0, 1fr)',
        background: 'linear-gradient(180deg, rgba(219, 234, 254, 0.7) 0%, rgba(255, 247, 237, 0.9) 100%)',
      }}
    >
      <nav
        style={{
          padding: '24px 18px',
          borderRight: '1px solid rgba(15, 23, 42, 0.08)',
          background: 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div
          style={{
            padding: '18px',
            borderRadius: 20,
            background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
            color: '#f8fafc',
            marginBottom: 18,
            boxShadow: '0 18px 40px rgba(15, 23, 42, 0.18)',
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.72 }}>
            Dashboard
          </div>
          <h1 style={{ marginTop: 10, fontSize: 28, lineHeight: 1.05 }}>
            coral-reef
          </h1>
          <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5, color: 'rgba(248, 250, 252, 0.8)' }}>
            REST + WebSocket visibility for jobs, sessions, discuss runs, workflows, metrics, and chat.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'block',
                padding: '12px 14px',
                borderRadius: 14,
                textDecoration: 'none',
                fontWeight: 600,
                color: isActive ? '#eff6ff' : '#0f172a',
                background: isActive
                  ? 'linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%)'
                  : 'rgba(255, 255, 255, 0.6)',
                boxShadow: isActive ? '0 10px 22px rgba(29, 78, 216, 0.22)' : 'none',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <div
          style={{
            marginTop: 18,
            padding: '14px 16px',
            borderRadius: 16,
            border: '1px solid rgba(15, 23, 42, 0.08)',
            background: 'rgba(255, 255, 255, 0.68)',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#475569',
          }}
        >
          Built frontend assets are served from <code>src/web/dist/</code>.
        </div>
      </nav>

      <main style={{ minWidth: 0, padding: 28 }}>
        <Outlet />
      </main>
    </div>
  );
}
