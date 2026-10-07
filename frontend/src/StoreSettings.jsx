import React, { useState } from 'react';
import { Download, ShieldCheck, Users } from 'lucide-react';
import UserAccessManager from './UserAccessManager.jsx';
import { LegacyImport, downloadWorkspace } from './OwnerTools.jsx';
import './store-settings.css';

export default function StoreSettings({ user, onSessionChanged, migrationNotice, onImported }) {
  const owner = user?.role === 'owner';
  const [selected, setSelected] = useState('access');
  const [visited, setVisited] = useState(['access']);
  const sections = [
    { key: 'access', title: owner ? 'کاربران و تغییر رمز' : 'تغییر رمز', Icon: Users },
    ...(owner ? [{ key: 'backup', title: 'پشتیبان و بازیابی', Icon: ShieldCheck }] : []),
  ];
  const active = sections.some(section => section.key === selected) ? selected : sections[0].key;

  function openSection(key) {
    setSelected(key);
    setVisited(previous => previous.includes(key) ? previous : [...previous, key]);
  }

  function renderSection(key) {
    switch (key) {
      case 'access':
        return <UserAccessManager user={user} onSessionChanged={onSessionChanged}/>;
      case 'backup':
        return <div className="noor-settings-backup">
          <div className="noor-settings-backup-download">
            <div><h2>نسخهٔ پشتیبان اطلاعات</h2><p>یک نسخه از اطلاعات حسابداری را دریافت و نزد خود نگهداری کنید.</p></div>
            <button type="button" className="noor-settings-action" onClick={downloadWorkspace}><Download size={17} aria-hidden="true"/> دریافت نسخهٔ پشتیبان</button>
          </div>
          <LegacyImport username={user.username} notice={migrationNotice} onImported={onImported}/>
        </div>;
      default:
        return null;
    }
  }

  return <section className="noor-settings" dir="rtl" aria-labelledby="noor-settings-title">
    <header className="noor-settings-heading">
      <div>
        <h1 id="noor-settings-title">تنظیمات حسابداری</h1>
        <p>{owner ? 'حساب کارکنان، دسترسی‌ها و نسخهٔ پشتیبان دفتر خود را مدیریت کنید.' : 'رمز ورود حساب خود را از اینجا تغییر دهید.'}</p>
        <p>حساب کاربری: <bdi>{user?.username}</bdi>{owner ? ' · مالک دفتر حسابداری' : ' · کارمند دفتر حسابداری'}</p>
      </div>
    </header>
    <div className="noor-settings-sections" role="group" aria-label="بخش‌های تنظیمات">
      {sections.map(({ key, title, Icon }) => <button
        type="button"
        key={key}
        id={`noor-settings-tab-${key}`}
        data-settings-tab={key}
        aria-pressed={active === key}
        aria-controls={`noor-settings-panel-${key}`}
        onClick={() => openSection(key)}
      ><Icon size={18} aria-hidden="true"/><span>{title}</span></button>)}
    </div>
    {sections.map(({ key }) => <section
      key={key}
      id={`noor-settings-panel-${key}`}
      className="noor-settings-panel"
      data-settings-panel={key}
      aria-labelledby={`noor-settings-tab-${key}`}
      hidden={active !== key}
    >{(visited.includes(key) || active === key) && renderSection(key)}</section>)}
  </section>;
}
