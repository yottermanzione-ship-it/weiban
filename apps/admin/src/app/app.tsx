import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { api } from '../data/client.js';
import { LoginPage } from '../features/login.js';
import { InvitesPage } from '../features/invites.js';
import { AccountsPage } from '../features/accounts.js';
import { UpstreamsPage } from '../features/upstreams.js';
import { CatalogPage } from '../features/catalog.js';
import { PricesPage } from '../features/prices.js';
import { AlertsPage, AlertBadge } from '../features/alerts.js';
import { CharactersPage } from '../features/characters.js';
import { UsagePage } from '../features/usage.js';
import { BillingPage } from '../features/billing.js';
import { ScenarioModesPage } from '../features/scenario-modes.js';
import { PublicUpdatesPage } from '../features/public-updates.js';
import { HolidaysPage } from '../features/holidays.js';
import { SymptomTagsPage } from '../features/symptom-tags.js';
import { RelationsPage } from '../features/relations.js';
import {
  CardTemplatesPage,
  StickerLibraryPage,
  VoiceLibraryPage,
  WorkLinksPage,
} from '../features/media-library.js';
import {
  AccountDeletionsPage,
  PendingDeletionBadge,
  PetSpeciesPage,
} from '../features/pets-deletions.js';
export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let session = await api.restore();
        if (session) {
          try {
            session = await api.updateUser(await api.call(IdentityEndpoints.me));
          } catch {
            session = await api.restore();
          }
        }
        if (session?.session.kind !== 'admin' || session.user.role !== 'admin') {
          await api.forget();
          session = null;
        }
        if (active) setAuth(session);
      } catch {
        if (active) setAuth(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    const expired = () => setAuth(null);
    window.addEventListener('weiban-admin:unauthenticated', expired);
    return () => {
      active = false;
      window.removeEventListener('weiban-admin:unauthenticated', expired);
    };
  }, []);
  async function logout() {
    try {
      await api.call(IdentityEndpoints.logout);
    } finally {
      await api.forget();
      setAuth(null);
    }
  }
  if (loading) return <p role="status">正在打开管理后台…</p>;
  if (!auth) return <LoginPage onLogin={setAuth} />;
  return (
    <div className="admin-shell">
      <aside>
        <strong className="brand">微伴管理后台</strong>
        <nav aria-label="管理导航">
          {[
            ['/characters', '角色库'],
            ['/invites', '邀请码'],
            ['/upstreams', '上游管理'],
            ['/catalog', '模型目录'],
            ['/prices', '价目表'],
            ['/accounts', '用户与余额'],
            ['/usage', '用量与费用'],
            ['/billing', '对账与平台花费'],
            ['/scenario-modes', '情景模式'],
            ['/public-updates', '公开动态'],
            ['/holidays', '节日清单'],
            ['/relations', '关系网'],
            ['/stickers', '表情包库'],
            ['/voices', '音色库'],
            ['/card-templates', '卡面模板库'],
            ['/work-links', '作品链接库'],
            ['/symptom-tags', '经期症状标签'],
            ['/pet-species', '宠物图鉴'],
            ['/account-deletions', '注销未完成'],
            ['/admin/alerts', '运行提醒'],
          ].map(([to, label]) => (
            <NavLink key={to} to={to!}>
              {label}
              {to === '/admin/alerts' && <AlertBadge />}
              {to === '/account-deletions' && <PendingDeletionBadge />}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="workspace">
        <header>
          <span>产品管理</span>
          <div>
            {auth.user.username}
            <button onClick={() => void logout().catch(() => {})}>退出登录</button>
          </div>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/invites" replace />} />
            <Route path="/characters" element={<CharactersPage />} />
            <Route path="/prices" element={<PricesPage />} />
            <Route path="/invites" element={<InvitesPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/upstreams" element={<UpstreamsPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/scenario-modes" element={<ScenarioModesPage />} />
            <Route path="/public-updates" element={<PublicUpdatesPage />} />
            <Route path="/holidays" element={<HolidaysPage />} />
            <Route path="/relations" element={<RelationsPage />} />
            <Route path="/stickers" element={<StickerLibraryPage />} />
            <Route path="/voices" element={<VoiceLibraryPage />} />
            <Route path="/card-templates" element={<CardTemplatesPage />} />
            <Route path="/work-links" element={<WorkLinksPage />} />
            <Route path="/symptom-tags" element={<SymptomTagsPage />} />
            <Route path="/pet-species" element={<PetSpeciesPage />} />
            <Route path="/account-deletions" element={<AccountDeletionsPage />} />
            <Route path="/admin/alerts" element={<AlertsPage />} />
            <Route path="*" element={<Navigate to="/invites" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
