import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ChatUI } from './components/ChatUI';
import { DiscussViewer } from './components/DiscussViewer';
import { JobDetail } from './components/JobDetail';
import { Kanban } from './components/Kanban';
import { Layout } from './components/Layout';
import { Sessions } from './components/Sessions';
import { Workflows } from './components/Workflows';

const Metrics = lazy(async () => {
  const module = await import('./components/Metrics');
  return { default: module.Metrics };
});

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Kanban />} />
        <Route path="jobs/:jobId" element={<JobDetail />} />
        <Route path="chat" element={<ChatUI />} />
        <Route path="chat/:sessionId" element={<ChatUI />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="discuss" element={<DiscussViewer />} />
        <Route path="discuss/:sessionId" element={<DiscussViewer />} />
        <Route path="workflows" element={<Workflows />} />
        <Route
          path="metrics"
          element={(
            <Suspense fallback={<RouteFallback />}>
              <Metrics />
            </Suspense>
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function RouteFallback() {
  return (
    <section className="panel">
      <h2 style={{ fontSize: 24 }}>Loading view...</h2>
      <p style={{ marginTop: 8, color: '#64748b' }}>Preparing the route bundle.</p>
    </section>
  );
}
