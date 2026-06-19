import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LayoutDashboard, Wallet, TrendingUp, Tags, GraduationCap, History as HistoryIcon, Trophy, Settings as SettingsIcon, Menu, X } from 'lucide-react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // ページ遷移したらメニューを閉じる
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ヘッダー + ナビを常時固定 (スクロールしても見える) */}
      <div className="sticky top-0 z-40 shadow-sm">
        <header className="bg-[var(--color-primary)] text-white">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link
              to="/"
              className="text-base font-semibold tracking-wide hover:opacity-80"
            >
              Asset Tracker
            </Link>
            <div className="flex items-center gap-3">
              <SyncIndicator />
              {/* スマホ: ハンバーガーボタン (md 以上は隠す) */}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
                className="md:hidden p-1 -mr-1"
              >
                {menuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>
        </header>

        {/* PC: 横並びタブナビ (md 以上で表示) */}
        <nav className="hidden md:block bg-[var(--color-primary-soft)] text-white">
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

        {/* スマホ: ハンバーガーで開閉する縦リスト (md 未満かつ menuOpen) */}
        {menuOpen && (
          <nav className="md:hidden bg-[var(--color-primary-soft)] text-white border-t border-white/10">
            <div className="max-w-5xl mx-auto flex flex-col">
              {NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    'flex items-center gap-2 px-4 py-3 text-sm border-l-4 ' +
                    (isActive
                      ? 'border-[var(--color-accent)] bg-white/10 text-[var(--color-accent)]'
                      : 'border-transparent text-white/90 hover:bg-white/5')
                  }
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      <ConnectionErrorOverlay />
    </div>
  );
}
