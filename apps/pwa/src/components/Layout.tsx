import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LayoutDashboard, Wallet, TrendingUp, Tags, GraduationCap, History as HistoryIcon, Trophy, Settings as SettingsIcon, ChevronRight } from 'lucide-react';
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
            <SyncIndicator />
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

      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      {/* スマホ: 左下に Pull tab (細め 1cm)。bottom-8 で画面下寄り、w-5 で控えめ。
          タップでサイドドロワーが下半分に表示される。タブはドロワー右端に追従。 */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
        className={`md:hidden fixed bottom-8 z-50 w-5 h-12 bg-[var(--color-primary)] text-white rounded-r-lg shadow-lg flex items-center justify-center active:scale-95 transition-all duration-300 ${
          menuOpen ? 'left-64' : 'left-0'
        }`}
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-300 ${menuOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* スマホ: 左下サイドドロワー (画面下半分 = 70vh)。translate-x で開閉。
          背後タップで閉じるバックドロップ付き。上端の右角を丸めて「下から出てる」
          印象に。 */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          className="md:hidden fixed inset-0 z-30 bg-black/30"
          aria-hidden
        />
      )}
      <nav
        className={`md:hidden fixed left-0 bottom-0 h-[70vh] z-40 w-64 bg-[var(--color-primary-soft)] text-white shadow-2xl rounded-tr-2xl transition-transform duration-300 ease-out ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!menuOpen}
      >
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">
          メニュー
        </div>
        <div className="flex flex-col overflow-y-auto h-[calc(100%-3rem)] pb-4">
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

      <ConnectionErrorOverlay />
    </div>
  );
}
