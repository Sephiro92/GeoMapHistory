import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, type HistoricalBordersStatus } from './api';
import { useAuth } from './auth';

export function AdminPage() {
  const { admin, ready } = useAuth();
  const [status, setStatus] = useState<HistoricalBordersStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .historicalBorders()
      .then(setStatus)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (admin) refresh();
  }, [admin, refresh]);

  // Suivi de l'opération en cours.
  const running = status?.job?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [running, refresh]);

  if (ready && !admin) return <Navigate to="/login" replace />;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function importBorders() {
    if (
      confirm(
        'Importer environ 3 000 territoires historiques (3000 av. J.-C. à 2010) ? ' +
          'Cela prend environ une minute et nécessite une connexion Internet.',
      )
    )
      run(api.importHistoricalBorders);
  }

  function removeBorders() {
    if (
      confirm(
        `Retirer les ${status?.imported} territoires importés ? Les modifications faites sur ces territoires ` +
          'seront perdues ; vos propres points et zones ne sont pas touchés.',
      )
    )
      run(api.removeHistoricalBorders);
  }

  const job = status?.job;

  return (
    <main className="page">
      <h1>Administration</h1>

      <section className="card">
        <h2>Frontières historiques</h2>
        <p>
          Ajoute à la carte les frontières des États et peuples de 3000 av. J.-C. à 2010, issues du projet{' '}
          <a href="https://github.com/aourednik/historical-basemaps" target="_blank" rel="noreferrer">
            historical-basemaps
          </a>
          . Optionnel : sans elles, la carte reste vierge et vous dessinez votre propre monde.
        </p>
        <p className="hint">
          Données sous licence GPL-3.0 : libres pour un usage personnel ; si vous diffusez la carte, elles doivent
          rester sous GPL-3.0 avec attribution. Les noms sont en anglais. Une fois importés, les territoires sont
          modifiables comme vos propres zones.
        </p>
        {status === null ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="actions">
            {status.imported > 0 ? (
              <>
                <span>{status.imported} territoires importés.</span>
                <button className="danger" onClick={removeBorders} disabled={running}>
                  Retirer les frontières historiques
                </button>
              </>
            ) : (
              <button className="primary" onClick={importBorders} disabled={running}>
                Importer les frontières historiques
              </button>
            )}
          </div>
        )}
        {job && (
          <p className={job.state === 'error' ? 'error' : job.state === 'running' ? 'hint' : ''}>
            {job.state === 'running' && '⏳ '}
            {job.state === 'done' && '✔ '}
            {job.state === 'error' && 'Échec : '}
            {job.message}
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <ContentArchive onImported={refresh} />
    </main>
  );
}

/** Export / import du contenu complet (dossier data, hors compte administrateur) en zip. */
function ContentArchive({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importArchive() {
    if (!file) return;
    if (
      !confirm(
        `Remplacer TOUT le contenu actuel (carte, wiki, images) par celui de « ${file.name} » ? ` +
          'Le contenu actuel sera d’abord sauvegardé dans data/backups.',
      )
    )
      return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const r = await api.importContent(file);
      setResult(r.message);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Sauvegarde du contenu</h2>
      <p>
        Le contenu (éléments de la carte, pages du wiki et leur historique, images) est enregistré dans le dossier{' '}
        <code>data</code>. L’archive permet de le sauvegarder ou de le transporter vers une autre installation ; le
        compte administrateur n’y figure pas.
      </p>
      <div className="actions">
        <a className="button primary" href="/api/admin/content">
          Exporter le contenu (.zip)
        </a>
      </div>
      <h3>Importer</h3>
      <p className="hint">
        Remplace tout le contenu actuel par celui de l’archive (export de cette page, sauvegarde de{' '}
        <code>scripts/backup.ps1</code> ou zip du dossier <code>data</code>). Une copie du contenu actuel est
        conservée dans <code>data/backups</code>.
      </p>
      <div className="actions">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
        <button className="danger" onClick={importArchive} disabled={!file || busy}>
          {busy ? 'Import en cours…' : 'Importer et remplacer'}
        </button>
      </div>
      {result && <p>✔ {result}</p>}
      {error && <p className="error">{error}</p>}
      <p className="hint">
        <a href="/api/export">Export JSON</a> : vue lisible du contenu, sans les images (non réimportable).
      </p>
    </section>
  );
}
