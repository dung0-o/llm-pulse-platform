import { NavLink } from 'react-router-dom';
import { BarChart3, Search, Activity, Home, PieChart, TrendingUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Leaderboard', icon: Home, end: true },
  { to: '/share-of-voice', label: 'Share of voice', icon: PieChart },
  { to: '/trend', label: 'Model Trend', icon: TrendingUpDown },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/health', label: 'System health', icon: Activity },
];

export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <BarChart3 className="h-5 w-5 text-accent" />
        <span className="text-sm font-semibold">LLM Pulse</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:bg-muted',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        v1.0.0
      </div>
    </aside>
  );
}
