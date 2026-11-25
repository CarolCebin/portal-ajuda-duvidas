'use client';

import { useEffect, useState } from 'react';

export default function AdminAccess() {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('link') === 'invalido') {
      setMessage('O link expirou ou foi aberto em outro navegador. Solicite um novo link.');
    }
  }, []);

  async function requestLink(event) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/acesso', { method: 'POST' });
      const data = await response.json();
      setMessage(response.ok ? 'Link enviado. Abra o e-mail neste mesmo navegador.' : data.erro);
    } catch {
      setMessage('Não foi possível solicitar o link. Tente novamente.');
    } finally {
      setPending(false);
    }
  }

  return <form className="admin-access" onSubmit={requestLink}>
    <button type="submit" className="button button-primary" disabled={pending}>
      {pending ? 'Solicitando…' : 'Solicitar link de acesso'}
    </button>
    {message && <p role="status">{message}</p>}
  </form>;
}
