import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { PageLoader } from './components/LoadingSpinner'
import { isTopologyLabEnabled } from './labs/topology/flags'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SourcesPage = lazy(() => import('./pages/SourcesPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const RecordsPage = lazy(() => import('./pages/RecordsPage'))
const SchedulesPage = lazy(() => import('./pages/SchedulesPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const WorkersPage = lazy(() => import('./pages/WorkersPage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const ProvidersPage = lazy(() => import('./pages/ProvidersPage'))
const NodesPage = lazy(() => import('./pages/NodesPage'))
const TopologyPage = lazy(() => import('./labs/topology/TopologyPage'))
const NetworkPage = lazy(() => import('./labs/topology/NetworkPage'))
const NodeKitPage = lazy(() => import('./labs/topology/NodeKitPage'))
const WorkflowPage = lazy(() => import('./labs/topology/workflow/WorkflowPage'))

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to={isTopologyLabEnabled ? '/labs/topology' : '/dashboard'} replace />} />
          <Route path="dashboard" element={<LazyRoute><DashboardPage /></LazyRoute>} />
          <Route path="settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
          <Route
            path="labs/topology"
            element={
              isTopologyLabEnabled ? (
                <LazyRoute>
                  <NetworkPage />
                </LazyRoute>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          <Route
            path="labs/node-kit"
            element={
              isTopologyLabEnabled ? (
                <LazyRoute>
                  <NodeKitPage />
                </LazyRoute>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          <Route
            path="labs/topology-editor"
            element={
              isTopologyLabEnabled ? (
                <LazyRoute>
                  <WorkflowPage />
                </LazyRoute>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          <Route path="labs/workflow" element={<Navigate to={isTopologyLabEnabled ? '/labs/topology-editor' : '/dashboard'} replace />} />
          <Route
            path="labs/topology-legacy"
            element={
              isTopologyLabEnabled ? (
                <LazyRoute>
                  <TopologyPage />
                </LazyRoute>
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          <Route path="topology" element={<Navigate to={isTopologyLabEnabled ? '/labs/topology' : '/dashboard'} replace />} />
          <Route path="sources" element={<LazyRoute><SourcesPage /></LazyRoute>} />
          <Route path="tasks" element={<LazyRoute><TasksPage /></LazyRoute>} />
          <Route path="records" element={<LazyRoute><RecordsPage /></LazyRoute>} />
          <Route path="schedules" element={<LazyRoute><SchedulesPage /></LazyRoute>} />
          <Route path="notifications" element={<LazyRoute><NotificationsPage /></LazyRoute>} />
          <Route path="workers" element={<LazyRoute><WorkersPage /></LazyRoute>} />
          <Route path="agents" element={<LazyRoute><AgentsPage /></LazyRoute>} />
          <Route path="providers" element={<LazyRoute><ProvidersPage /></LazyRoute>} />
          <Route path="browsers" element={<Navigate to="/nodes" replace />} />
          <Route path="nodes" element={<LazyRoute><NodesPage /></LazyRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
