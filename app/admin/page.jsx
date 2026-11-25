import { cookies } from 'next/headers';
import { forbidden } from 'next/navigation';
import EvaluationPanel from '../../components/EvaluationPanel';
import { readAdmin } from '../../lib/server/admin-auth.mjs';

export const metadata = { title: 'Avaliação da IA | Administração' };

export default async function AdminPage() {
  const admin = await readAdmin(await cookies()).catch(() => null);
  if (!admin) forbidden();

  return <div className="admin-shell">
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="/">Central de Ajuda</a>
        <form method="post" action="/api/admin/sair"><button className="button button-admin">Sair</button></form>
      </div>
    </header>
    <EvaluationPanel />
  </div>;
}
