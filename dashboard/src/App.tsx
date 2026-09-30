import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import DashboardPage from '@/pages/DashboardPage';
import ModelPage from '@/pages/ModelPage';
import SearchPage from '@/pages/SearchPage';
import ShareOfVoicePage from '@/pages/ShareOfVoicePage';
import HealthPage from '@/pages/HealthPage';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/share-of-voice" element={<ShareOfVoicePage />} />
        <Route path="/trend" element={<ModelPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
