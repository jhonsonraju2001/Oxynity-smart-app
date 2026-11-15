import React from 'react';
import { Home, FileText, Activity, Wrench } from 'lucide-react';

export type TabType =
  | 'home'
  | 'reports'
  | 'sensors'
  | 'service'
  | 'dashboard'
  | 'analytics'
  | 'location'
  | 'settings'
  | 'addDevice';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  hasDeviceLinked?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChangeTab }) => {
  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'sensors', label: 'Sensors', icon: Activity },
    { id: 'service', label: 'Service', icon: Wrench },
  ] as const;

  // Map legacy tab IDs to one of the 4 main tabs for active state highlighting
  const currentMainTab: 'home' | 'reports' | 'sensors' | 'service' =
    activeTab === 'dashboard' || activeTab === 'addDevice'
      ? 'home'
      : activeTab === 'analytics'
      ? 'reports'
      : activeTab === 'sensors'
      ? 'sensors'
      : activeTab === 'service'
      ? 'service'
      : (activeTab as any);

  return (
    <nav
      className="w-full shrink-0 bg-white dark:bg-[#12313A] border-t border-[#DDE8EA] dark:border-[#1F4650] shadow-lg px-2 pt-2 transition-all z-30 select-none"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
    >
      <div className="w-full sm:max-w-[430px] mx-auto flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentMainTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id as TabType)}
              className={`flex-1 flex flex-col items-center justify-center min-h-[52px] py-1 px-1 rounded-xl transition-all duration-150 cursor-pointer active:scale-95 touch-manipulation ${
                isActive
                  ? 'text-[#0E7C86] dark:text-[#19C3D1] font-extrabold'
                  : 'text-[#5B7479] dark:text-[#9DB8BD] hover:text-[#0B2B33] dark:hover:text-[#E8F4F6] font-bold'
              }`}
              title={tab.label}
            >
              <Icon
                className={`w-5 h-5 mb-1 transition-transform ${
                  isActive ? 'stroke-[2.5px] scale-110' : 'stroke-[1.9px]'
                }`}
              />
              <span className="text-[11px] tracking-tight leading-tight text-center font-sans font-extrabold">
                {tab.label}
              </span>
              {isActive && (
                <span className="w-1.5 h-1 bg-[#0E7C86] dark:bg-[#19C3D1] rounded-full mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
