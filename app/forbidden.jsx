import AdminAccess from '../components/AdminAccess';

export default function Forbidden() {
  return <main className="content-width main-content admin-denied">
    <div className="admin-panel">
      <h1>Acesso negado</h1>
      <p>A área administrativa é restrita à conta autorizada.</p>
      <AdminAccess />
      <a href="/">Voltar para a página inicial</a>
    </div>
  </main>;
}
