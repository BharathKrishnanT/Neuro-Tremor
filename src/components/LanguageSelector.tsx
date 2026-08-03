import React, { useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Check } from 'lucide-react';
import { useLanguage, LANGUAGES, LanguageCode } from '../lib/i18n';

export const LanguageSelector: React.FC = () => {
  const { lang, setLang, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLangObj = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors text-sm font-medium"
        title={t('selectLanguage')}
      >
        <Languages size={16} className="text-emerald-400" />
        <span className="text-xs mr-0.5">{currentLangObj.flag}</span>
        <span className="hidden md:inline">{currentLangObj.nativeName}</span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 py-1 max-h-72 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800 flex items-center justify-between">
            <span>{t('language')}</span>
            <Languages size={12} />
          </div>
          {LANGUAGES.map((item) => {
            const isSelected = item.code === lang;
            return (
              <button
                key={item.code}
                onClick={() => {
                  setLang(item.code as LanguageCode);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                  isSelected
                    ? 'bg-emerald-500/10 text-emerald-400 font-medium'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className="text-base">{item.flag}</span>
                  <div>
                    <span className="block font-medium leading-none">{item.nativeName}</span>
                    <span className="block text-[10px] text-zinc-500 leading-tight mt-0.5">{item.name}</span>
                  </div>
                </div>
                {isSelected && <Check size={14} className="text-emerald-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
