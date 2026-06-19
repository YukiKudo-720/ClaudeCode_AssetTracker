import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { Dashboard } from './pages/Dashboard.js';
import { Accounts } from './pages/Accounts.js';
import { Holdings } from './pages/Holdings.js';
import { Categories } from './pages/Categories.js';
import { Todai } from './pages/Todai.js';
import { History } from './pages/History.js';
import { Ranking } from './pages/Ranking.js';
import { Settings } from './pages/Settings.js';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="holdings" element={<Holdings />} />
        <Route path="categories" element={<Categories />} />
        <Route path="todai" element={<Todai />} />
        <Route path="history" element={<History />} />
        <Route path="ranking" element={<Ranking />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
