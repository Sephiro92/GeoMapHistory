import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { AdminPage } from './AdminPage';
import { useAuth } from './auth';
import { Login } from './Login';
import { MapPage } from './map/MapPage';
import { WikiEdit } from './wiki/WikiEdit';
import { WikiHistory } from './wiki/WikiHistory';
import { WikiList } from './wiki/WikiList';
import { WikiView } from './wiki/WikiView';

export function App() {
  const { admin, logout } = useAuth();

  return (
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="brand">
          GeoMapHistory
        </Link>
        <NavLink to="/" end>
          Carte
        </NavLink>
        <NavLink to="/wiki">Wiki</NavLink>
        <span className="spacer" />
        {admin ? (
          <>
            <span className="badge">Admin</span>
            <NavLink to="/admin">Administration</NavLink>
            <button className="link-button" onClick={logout}>
              Déconnexion
            </button>
          </>
        ) : (
          <NavLink to="/login">Connexion</NavLink>
        )}
      </nav>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/wiki" element={<WikiList />} />
        <Route path="/wiki/new" element={<WikiEdit />} />
        <Route path="/wiki/:slug" element={<WikiView />} />
        <Route path="/wiki/:slug/edit" element={<WikiEdit />} />
        <Route path="/wiki/:slug/history" element={<WikiHistory />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<main className="page">Page introuvable.</main>} />
      </Routes>
    </div>
  );
}
