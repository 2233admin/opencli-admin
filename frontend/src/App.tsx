import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { PageLoader } from './components/LoadingSpinner'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SourcesPage = lazy(() => import('./pages/SourcesPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const RecordsPage = lazy(() => import('./pages/RecordsPage'))
const SchedulesPage = lazy(() => import('./pages/SchedulesPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const WorkersPage = lazy(() => import('./pages/WorkersPage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const SkillDetailPage = lazy(() => import('./pages/SkillDetailPage'))
const ProvidersPage = lazy(() => import('./pages/ProvidersPage'))
const NodesPage = lazy(() => import('./pages/NodesPage'))
const ActionHistoryPage = lazy(() => import('./pages/ActionHistoryPage'))
const SourceControlRoomPage = lazy(() => import('./pages/SourceControlRoomPage'))
const PlanCanvasPage = lazy(() => import('./pages/PlanCanvasPage'))

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<LazyRoute><DashboardPage /></LazyRoute>} />
          <Route path="settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
          {/* Collection Canvas is ONE surface (ADR-0008): the Plan canvas at /plans
           * is the single canvas entry. These paths are legacy redirects kept only
           * so old links/bookmarks (global topology, node-kit / workflow labs) land
           * somewhere sensible. */}
          <Route path="labs/topology" element={<Navigate to="/plans" replace />} />
          <Route path="labs/node-kit" element={<Navigate to="/plans" replace />} />
          <Route path="labs/topology-editor" element={<Navigate to="/plans" replace />} />
          <Route path="labs/workflow" element={<Navigate to="/plans" replace />} />
          <Route path="labs/topology-legacy" element={<Navigate to="/plans" replace />} />
          <Route path="topology" element={<Navigate to="/plans" replace />} />
          <Route path="plans" element={<LazyRoute><PlanCanvasPage /></LazyRoute>} />
          <Route path="plans/new" element={<LazyRoute><PlanCanvasPage /></LazyRoute>} />
          <Route path="plans/:planId" element={<LazyRoute><PlanCanvasPage /></LazyRoute>} />
          <Route path="sources" element={<LazyRoute><SourcesPage /></LazyRoute>} />
          <Route path="sources/:sourceId/control-room" element={<LazyRoute><SourceControlRoomPage /></LazyRoute>} />
          <Route path="tasks" element={<LazyRoute><TasksPage /></LazyRoute>} />
          <Route path="records" element={<LazyRoute><RecordsPage /></LazyRoute>} />
          <Route path="schedules" element={<LazyRoute><SchedulesPage /></LazyRoute>} />
          <Route path="notifications" element={<LazyRoute><NotificationsPage /></LazyRoute>} />
          <Route path="workers" element={<LazyRoute><WorkersPage /></LazyRoute>} />
          <Route path="agents" element={<LazyRoute><AgentsPage /></LazyRoute>} />
          <Route path="skills" element={<LazyRoute><SkillsPage /></LazyRoute>} />
          <Route path="skills/:id" element={<LazyRoute><SkillDetailPage /></LazyRoute>} />
          <Route path="providers" element={<LazyRoute><ProvidersPage /></LazyRoute>} />
          <Route path="browsers" element={<Navigate to="/nodes" replace />} />
          <Route path="nodes" element={<LazyRoute><NodesPage /></LazyRoute>} />
          <Route path="control/actions" element={<LazyRoute><ActionHistoryPage /></LazyRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
