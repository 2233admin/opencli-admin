import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { PageLoader } from './components/LoadingSpinner'
import DashboardPage from './pages/DashboardPage'
import SettingsPage from './pages/SettingsPage'
import SourcesPage from './pages/SourcesPage'
import TasksPage from './pages/TasksPage'
import RecordsPage from './pages/RecordsPage'
import SchedulesPage from './pages/SchedulesPage'
import NotificationsPage from './pages/NotificationsPage'
import WorkersPage from './pages/WorkersPage'
import AgentsPage from './pages/AgentsPage'
import ProvidersPage from './pages/ProvidersPage'
import NodesPage from './pages/NodesPage'

const TopologyPage = lazy(() => import('./pages/TopologyPage'))

export default function App() {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="topology"
            element={
              <Suspense fallback={<PageLoader />}>
                <TopologyPage />
              </Suspense>
            }
          />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="records" element={<RecordsPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="workers" element={<WorkersPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="browsers" element={<Navigate to="/nodes" replace />} />
          <Route path="nodes" element={<NodesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
