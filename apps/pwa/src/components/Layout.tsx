import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Wallet, TrendingUp, Tags, GraduationCap, History as HistoryIcon, Trophy, Settings as SettingsIcon } from 'lucide-react';
import { SyncIndicator } from './SyncIndicator.js';
import { ConnectionErrorOverlay } from './ConnectionErrorOverlay.js';

const NAV = [
  { to: '/', label: 'ダッシュボード', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: '口座', icon: Wallet },
  { to: '/holdings', label: '銘柄', icon: TrendingUp },
  { to: '/categories', label: 'テーマ', icon: Tags },
  { to: '/todai', label: '東大', icon: GraduationCap },
  { to: '/history', label: '履歴', icon: HistoryIcon },
  { to: '/ranking', label: 'ランキング', icon: Trophy },
  { to: '/settings', label: '設定', icon: SettingsIcon },
];

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* ヘッダー + ナビを常時固定 (スクロールしても見える) */}
      <div className="sticky top-0 z-40 shadow-sm">
        <header className="bg-[var(--color-primary)] text-white">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <h1 className="text-base font-semibold tracking-wide">Asset Tracker</h1>
            <SyncIndicator />
          </div>
        </header>

        <nav className="bg-[var(--color-primary-soft)] text-white">
          <div className="max-w-5xl mx-auto px-2 flex overflow-x-auto">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  'flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap ' +
                  (isActive
                    ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-b-2 border-transparent text-white/80 hover:text-white')
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      <ConnectionErrorOverlay />
    </div>
  );
}
