import './globals.css';
export const metadata = {
  title: 'Central de Ajuda | Aplicativo',
  description: 'Encontre respostas, explore tutoriais e tire suas dúvidas sobre o aplicativo.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
